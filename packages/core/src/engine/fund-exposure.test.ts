// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { InstrumentIds } from '../model/types.ts';
import type { FundPortfolio } from '../plugins/prices/fund-holdings/types.ts';

import { fundExposure } from './fund-exposure.ts';
import { summary } from './portfolio.ts';
import { PriceBook } from './prices.ts';
import { Ledger } from './testkit.ts';

const report: FundPortfolio = {
  id: 'ppfas:example',
  schemeName: 'Example Equity Fund',
  source: 'ppfas',
  sourceUrl: 'https://amc.ppfas.com/downloads/portfolio-disclosure/example.xls',
  asOf: '2026-09-30',
  reportedWeight: 1,
  derivatives: false,
  warnings: [],
  amfiCodes: ['123'],
  constituents: [
    { name: 'One', isin: 'INE001', kind: 'stock', assetClass: 'equity', weight: 0.6 },
    { name: 'Two', isin: 'INE002', kind: 'stock', assetClass: 'equity', weight: 0.2 },
    { name: 'Cash', kind: 'cash', assetClass: 'cash', weight: 0.2 },
  ],
};
const reference = {
  portfolios: [report],
  schemes: [{ code: '123', name: 'Example Equity Fund Direct Growth', isinGrowth: 'INF001' }],
  stocks: [
    { symbol: 'ONE', isin: 'INE001', industry: 'Financial Services', marketCap: 'large' as const },
    {
      symbol: 'TWO',
      isin: 'INE002',
      industry: 'Information Technology',
      marketCap: 'mid' as const,
    },
  ],
  caps: [
    { isin: 'INE001', nse: 'ONE', cap: 'large' as const },
    { isin: 'INE002', nse: 'TWO', cap: 'mid' as const },
  ],
};

function holdings(includeSecond = false) {
  const l = new Ledger().member().account({ id: 'a' });
  const rows: [string, 'stock' | 'mf' | 'cash', number, InstrumentIds, string][] = [
    ['s', 'stock', 100, { isin: 'INE001' }, 'One'],
    ['f', 'mf', 1000, { amfi: '123' }, 'Example Equity Fund Direct Growth'],
    ['c', 'cash', 100, {}, 'Cash'],
  ];

  if (includeSecond) {
    rows.push(['g', 'mf', 500, {}, 'Second Fund Direct Growth']);
  }

  for (const [id, kind, value, ids, name] of rows) {
    l.instrument({ id, kind, name, ids, assetClass: kind === 'cash' ? 'cash' : 'equity' });
    l.put('snapshot', {
      id,
      accountId: 'a',
      instrumentId: id,
      asOf: '2026-10-23',
      units: 1,
      invested: value,
      value,
      source: { kind: 'manual' },
    });
  }

  return summary(l.state(), new PriceBook(), '2026-10-23').holdings;
}

describe('fund underlying exposure', () => {
  it('combines direct stocks with reported fund weights without turning fund cash into equity', () => {
    const r = fundExposure(holdings(), '2026-10-23', reference);

    expect(r.stocks.total).toBe(900);
    expect(r.stocks.rows[0]).toMatchObject({
      key: 'isin:INE001',
      value: 700,
      directValue: 100,
      indirectValue: 600,
      gain: null,
    });
    expect(r.sectors.slices.find((s) => s.label === 'Financial Services')?.value).toBe(700);
    expect(r.marketCap.total).toBe(900);
    expect(r.assetSplit.slices.find((s) => s.label === 'cash')?.value).toBe(300);
    expect(r.coverage).toMatchObject({ total: 1000, covered: 1000, missing: 0 });
    expect(r.funds[0]?.constituents.find((c) => c.isin === 'INE001')).toMatchObject({
      weight: 0.6,
      value: 600,
    });
  });

  it('keeps missing fund value unclassified and does not fabricate stock gains', () => {
    const r = fundExposure(holdings(true), '2026-10-23', reference);

    expect(r.coverage).toMatchObject({ total: 1500, covered: 1000, missing: 500 });
    expect(r.sectors.slices.find((s) => s.label === 'Unclassified')?.value).toBe(500);
    expect(r.marketCap.slices.find((s) => s.label === 'Unclassified')?.value).toBe(500);
    // The asset split places it by the fund's own type instead, and says how much.
    expect(r.assetSplit.slices.find((s) => s.label === 'Unclassified')).toBeUndefined();
    expect(r.assetSplit.slices.find((s) => s.label === 'equity')?.value).toBe(100 + 800 + 500);
    expect(r.byFundType).toBe(500);
    expect(r.funds.find((f) => f.name.startsWith('Second'))?.status).toBe('unavailable');
    expect(r.stocks.rows.find((s) => s.key === 'isin:INE002')?.gain).toBeNull();
  });

  it('expands funds of funds and preserves an unresolved cycle instead of double-counting', () => {
    const nested: FundPortfolio = {
      ...report,
      id: 'ppfas:nested',
      schemeName: 'Nested Fund',
      amfiCodes: ['456'],
      constituents: [
        { name: report.schemeName, amfi: '123', kind: 'fund', assetClass: 'equity', weight: 0.5 },
        { name: 'Cash', kind: 'cash', assetClass: 'cash', weight: 0.5 },
      ],
    };
    const h = holdings()
      .filter((h) => h.instrument.kind === 'mf')
      .map((h) => ({ ...h, instrument: { ...h.instrument, ids: { amfi: '456' } } }));
    const expanded = fundExposure(h, '2026-10-23', { ...reference, portfolios: [report, nested] });

    expect(expanded.stocks.total).toBe(400);
    expect(expanded.assetSplit.slices.find((s) => s.label === 'cash')?.value).toBe(600);
    const cyclic = {
      ...nested,
      constituents: [
        {
          name: 'Nested Fund',
          amfi: '456',
          kind: 'fund' as const,
          assetClass: 'equity' as const,
          weight: 1,
        },
      ],
    };
    const r = fundExposure(h, '2026-10-23', { ...reference, portfolios: [cyclic] });

    expect(r.coverage.missing).toBe(1000);
    expect(r.stocks.total).toBe(0);
    expect(r.byFundType).toBe(1000);
  });

  it('computes overlap from net-asset stock weights without normalizing away cash', () => {
    const second: FundPortfolio = {
      ...report,
      id: 'ppfas:second',
      schemeName: 'Second Fund',
      amfiCodes: [],
      constituents: [
        { ...report.constituents[0]!, weight: 0.4 },
        { ...report.constituents[2]!, weight: 0.6 },
      ],
    };
    const r = fundExposure(holdings(true), '2026-10-23', {
      ...reference,
      portfolios: [report, second],
    });

    expect(r.overlap[0]).toMatchObject({ share: 0.4, stocks: 1 });
    expect(r.stocks.rows[0]?.value).toBe(900);
  });

  it('does not use future portfolios or ambiguous scheme names', () => {
    expect(fundExposure(holdings(), '2026-09-01', reference).coverage.covered).toBe(0);
    const duplicate = {
      ...report,
      id: 'ppfas:other',
      amfiCodes: [],
      constituents: [{ ...report.constituents[0]!, weight: 1 }],
    };
    const h = holdings()
      .filter((h) => h.instrument.kind === 'mf')
      .map((h) => ({ ...h, instrument: { ...h.instrument, ids: {} } }));

    expect(
      fundExposure(h, '2026-10-23', { ...reference, portfolios: [report, duplicate] }).coverage
        .covered,
    ).toBe(0);
  });

  it('matches a Groww name without "Fund", but only to a single report', () => {
    const groww = holdings()
      .filter((h) => h.instrument.kind === 'mf')
      .map((h) => ({
        ...h,
        instrument: { ...h.instrument, ids: {}, name: 'Example Equity Direct Growth' },
      }));

    expect(fundExposure(groww, '2026-10-23', reference).coverage.covered).toBe(1000);
    const twin = { ...report, id: 'ppfas:twin', schemeName: 'Example Equity' };

    expect(
      fundExposure(groww, '2026-10-23', { ...reference, portfolios: [report, twin] }).coverage
        .covered,
    ).toBe(1000);
    const other = { ...twin, schemeName: 'Example Equity Fund ' };

    expect(
      fundExposure(groww, '2026-10-23', { ...reference, portfolios: [report, other] }).coverage
        .covered,
    ).toBe(0);
  });

  it('treats a report that adds up to 99% as rounding, not as unclassified stocks', () => {
    const debt: FundPortfolio = {
      ...report,
      constituents: [
        { name: 'Bond', isin: 'INE00B', kind: 'debt', assetClass: 'debt', weight: 0.6 },
        { name: 'Cash', kind: 'cash', assetClass: 'cash', weight: 0.39 },
      ],
    };
    const h = holdings().filter((h) => h.instrument.kind === 'mf');
    const r = fundExposure(h, '2026-10-23', { ...reference, portfolios: [debt] });

    expect(r.funds[0]).toMatchObject({ status: 'available', coverage: 1 });
    expect(r.coverage).toMatchObject({ covered: 1000, missing: 0 });
    expect(r.sectors.total).toBe(0);
    expect(r.marketCap.total).toBe(0);
    expect(r.assetSplit.slices.map((s) => s.label)).toEqual(['debt', 'cash', 'other']);
    expect(r.assetSplit.total).toBeCloseTo(1000);
  });

  it('falls back to the NSE symbol when a stock’s ISIN is not in the lists', () => {
    const h = holdings().map((h) =>
      h.instrument.kind === 'stock'
        ? { ...h, instrument: { ...h.instrument, ids: { isin: 'INE001OLD', nse: 'one' } } }
        : h,
    );
    const r = fundExposure(h, '2026-10-23', reference);

    expect(r.sectors.slices.find((s) => s.label === 'Unclassified')).toBeUndefined();
    expect(r.marketCap.slices.find((s) => s.label === 'Large cap')?.value).toBe(700);
    expect(r.stocks.rows[0]).toMatchObject({
      key: 'isin:INE001',
      directValue: 100,
      indirectValue: 600,
    });
  });

  it('takes cap sizes from AMFI’s list, not NSE index membership', () => {
    const amfiMid = { ...reference, caps: [{ isin: 'INE001', cap: 'mid' as const }] };
    const r = fundExposure(holdings(), '2026-10-23', amfiMid);

    expect(r.marketCap.slices.find((s) => s.label === 'Mid cap')?.value).toBe(700);
    expect(r.marketCap.slices.find((s) => s.label === 'Large cap')).toBeUndefined();
    const none = fundExposure(holdings(), '2026-10-23', { ...reference, caps: [] });

    expect(none.marketCap.classified).toBe(0);
  });

  it('finds a direct stock’s cap size by NSE symbol when it has no ISIN', () => {
    const h = holdings()
      .filter((h) => h.instrument.kind === 'stock')
      .map((h) => ({ ...h, instrument: { ...h.instrument, ids: { nse: 'boschltd' } } }));
    const caps = [{ isin: 'INE323A01026', nse: 'BOSCHLTD', cap: 'mid' as const }];
    const r = fundExposure(h, '2026-10-23', { caps });

    expect(r.marketCap.slices).toEqual([{ label: 'Mid cap', value: 100, share: 1 }]);
  });

  it('groups a report’s industries into NSE sectors for stocks outside NSE’s lists', () => {
    const industries: FundPortfolio = {
      ...report,
      constituents: [
        {
          name: 'Bank',
          isin: 'INE00X',
          kind: 'stock',
          assetClass: 'equity',
          weight: 0.5,
          industry: 'Banks',
        },
        {
          name: 'Listed',
          isin: 'INE001',
          kind: 'stock',
          assetClass: 'equity',
          weight: 0.2,
          industry: 'IT - Software',
        },
        {
          name: 'Abroad',
          isin: 'US0001',
          kind: 'stock',
          assetClass: 'equity',
          weight: 0.3,
          industry: 'Computer Software ##',
        },
      ],
    };
    const r = fundExposure(holdings(), '2026-10-23', { ...reference, portfolios: [industries] });
    const sector = (label: string) => r.sectors.slices.find((s) => s.label === label)?.value;

    expect(sector('Financial Services')).toBe(500 + 200 + 100); // NSE's list wins for INE001.
    expect(sector('Information Technology')).toBeUndefined();
    expect(sector('Unclassified')).toBe(300);
  });

  it('classifies a direct stock by the industry any fund report gives it', () => {
    const banks: FundPortfolio = {
      ...report,
      constituents: [
        {
          name: 'One',
          isin: 'INE001',
          kind: 'stock',
          assetClass: 'equity',
          weight: 1,
          industry: 'Banks',
        },
      ],
    };
    const h = holdings().filter((h) => h.instrument.kind === 'stock');
    const r = fundExposure(h, '2026-10-23', { portfolios: [banks] });

    expect(r.sectors.slices).toEqual([{ label: 'Financial Services', value: 100, share: 1 }]);
  });

  it('places a fund without a report by its own type in the asset split only', () => {
    const l = new Ledger().member().account({ id: 'a' });

    l.instrument({ id: 'g', kind: 'etf', name: 'Gold ETF', ids: {}, assetClass: 'gold' });
    l.put('snapshot', {
      id: 'g',
      accountId: 'a',
      instrumentId: 'g',
      asOf: '2026-10-23',
      units: 1,
      invested: 800,
      value: 800,
      source: { kind: 'manual' },
    });
    const h = summary(l.state(), new PriceBook(), '2026-10-23').holdings;
    const r = fundExposure(h, '2026-10-23', reference);

    expect(r.assetSplit.slices).toEqual([{ label: 'gold', value: 800, share: 1 }]);
    expect(r.byFundType).toBe(800);
    expect(r.sectors.total).toBe(0);
    expect(r.funds[0]?.status).toBe('unavailable');
  });

  it('marks reports kept from an earlier refresh', () => {
    const fund = (retained?: string[]) =>
      fundExposure(holdings(), '2026-10-23', { ...reference, retained }).funds[0];

    expect(fund()?.retained).toBe(false);
    expect(fund(['ppfas:other'])?.retained).toBe(false);
    expect(fund([report.id])?.retained).toBe(true);
  });

  it('matches spacing variants through AMFI identifiers while keeping ambiguous names unresolved', () => {
    const portfolio = {
      ...report,
      schemeName: 'Zerodha Nifty Large Midcap 250 Index Fund',
      amfiCodes: [],
    };
    const h = holdings()
      .filter((h) => h.instrument.kind === 'mf')
      .map((h) => ({
        ...h,
        instrument: { ...h.instrument, ids: { isin: 'INF001' }, name: 'Imported fund' },
      }));
    const schemes = [
      {
        code: '123',
        name: 'Zerodha Nifty LargeMidcap250 Index Fund Direct Growth',
        isinGrowth: 'INF001',
      },
    ];

    expect(
      fundExposure(h, '2026-10-23', { portfolios: [portfolio], schemes }).coverage.covered,
    ).toBe(1000);
    const duplicate = {
      ...portfolio,
      id: 'other',
      schemeName: 'Zerodha Nifty LargeMidcap250 Index Fund',
    };

    expect(
      fundExposure(h, '2026-10-23', { portfolios: [portfolio, duplicate], schemes }).coverage
        .covered,
    ).toBe(0);
  });
});
