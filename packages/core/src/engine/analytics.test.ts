// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { portfolioAnalytics, rebalancePlan } from './analytics.ts';
import { summary } from './portfolio.ts';
import { PriceBook } from './prices.ts';
import { Ledger } from './testkit.ts';

function portfolio() {
  const l = new Ledger().member().account({ id: 'a' }).account({ id: 'b' });
  const add = (
    id: string,
    kind: 'stock' | 'mf' | 'cash' | 'ppf',
    value: number,
    name = id,
    accountId = 'a',
  ) => {
    l.instrument({
      id,
      kind,
      name,
      assetClass: kind === 'cash' ? 'cash' : kind === 'ppf' ? 'debt' : 'equity',
      ids: id === 'stock' ? { isin: 'INE001', nse: 'ONE' } : id === 'fund' ? { amfi: '123' } : {},
    });
    l.put('snapshot', {
      id: `s_${id}_${accountId}`,
      accountId,
      instrumentId: id,
      asOf: '2026-10-22',
      units: 1,
      value,
      invested: value,
      source: { kind: 'manual' },
    });
  };
  add('stock', 'stock', 200);
  add('stock', 'stock', 100, 'stock', 'b');
  add('unknown', 'stock', 100);
  add('fund', 'mf', 200, 'Sample fund');
  add('flexi', 'mf', 100, 'Flexi Cap Direct Growth');
  add('cash', 'cash', 300);
  return summary(l.state(), new PriceBook(), '2026-10-22').holdings;
}

const refs = {
  schemes: [
    { code: '123', name: 'Nifty Midcap 150 Index Fund', category: 'Other Scheme - Index Funds' },
  ],
  stocks: [
    { symbol: 'ONE', isin: 'INE001', industry: 'Financial Services', marketCap: 'large' as const },
  ],
  caps: [{ isin: 'INE001', nse: 'ONE', cap: 'large' as const }],
};

describe('portfolio analytics', () => {
  it('uses eligible totals and leaves undisclosed fund stock exposure unclassified', () => {
    const a = portfolioAnalytics(portfolio(), '2026-10-22', refs);
    expect(a.total).toBe(1000);
    expect(a.sectors.total).toBe(700);
    expect(a.sectors.classified).toBe(300);
    expect(a.sectors.slices).toContainEqual({
      label: 'Unclassified',
      value: 400,
      share: 400 / 700,
    });
    expect(a.marketCap.total).toBe(700);
    expect(a.marketCap.slices.find((s) => s.label === 'Mid cap')).toBeUndefined();
    expect(a.marketCap.slices.find((s) => s.label === 'Unclassified')?.value).toBe(400);
    expect(a.strategy.total).toBe(300);
    expect(a.strategy.slices.find((s) => s.label === 'Passive')?.value).toBe(200);
  });

  it('consolidates the same stock across accounts before computing concentration', () => {
    const a = portfolioAnalytics(portfolio(), '2026-10-22', refs);
    expect(a.stocks.rows).toHaveLength(2);
    expect(a.stocks.rows[0]).toMatchObject({ value: 300, share: 0.75, portfolioShare: 0.3 });
    expect(a.stocks.top1).toBe(0.75);
    expect(a.stocks.effectiveCount).toBeCloseTo(1.6);
  });

  it('handles an empty portfolio without NaN or invented classifications', () => {
    const a = portfolioAnalytics([], '2026-10-22');
    expect(a.total).toBe(0);
    expect(a.stocks.effectiveCount).toBeNull();
    expect(a.sectors.slices).toEqual([]);
  });

  it('resolves NSE symbol aliases to ISIN before measuring stock concentration', () => {
    const held = portfolio();
    const original = held.find((h) => h.instrument.id === 'stock')!;
    const alias = {
      ...original,
      key: 'alias',
      value: 100,
      instrument: { ...original.instrument, id: 'other-stock-record', ids: { nse: 'one' } },
    };
    const a = portfolioAnalytics([...held, alias], '2026-10-22', refs);
    expect(a.stocks.rows).toHaveLength(2);
    expect(a.stocks.top1).toBe(0.8);
    expect(a.holdings.rows.filter((r) => r.key === 'isin:INE001')).toHaveLength(1);
  });

  it('consolidates matching US and BSE symbols when no ISIN is available', () => {
    const h = portfolio().find((h) => h.instrument.kind === 'stock')!;
    for (const ids of [{ us: 'AAPL' }, { bse: '500325' }]) {
      const a = portfolioAnalytics(
        [
          { ...h, instrument: { ...h.instrument, id: 'one', ids } },
          { ...h, instrument: { ...h.instrument, id: 'two', ids } },
        ],
        '2026-10-22',
      );
      expect(a.stocks.count).toBe(1);
      expect(a.stocks.top1).toBe(1);
    }
  });

  it('does not infer sector or cap size from an unknown stock name', () => {
    const a = portfolioAnalytics(portfolio(), '2026-10-22');
    expect(a.sectors.classified).toBe(0);
    expect(a.marketCap.slices.find((s) => s.label === 'Unclassified')?.value).toBe(700);
  });
});

describe('rebalance scenarios', () => {
  it('computes signed INR gaps and includes extra contributions', () => {
    const p = rebalancePlan({ equity: 700, cash: 300 }, { equity: 60, cash: 40 }, 200);
    expect(p.valid).toBe(true);
    expect(p.rows.find((r) => r.assetClass === 'equity')).toMatchObject({
      targetValue: 720,
      change: 20,
    });
    expect(p.rows.find((r) => r.assetClass === 'cash')?.change).toBe(180);
  });
  it('rejects incomplete, negative, nonfinite and over-100 targets', () => {
    for (const targets of [
      { equity: 90 },
      { equity: -10, cash: 110 },
      { equity: NaN },
      { equity: 101 },
    ]) {
      expect(rebalancePlan({ equity: 100 }, targets).valid).toBe(false);
    }
    expect(rebalancePlan({ equity: 100 }, { equity: 100 }, -1).valid).toBe(false);
  });
});
