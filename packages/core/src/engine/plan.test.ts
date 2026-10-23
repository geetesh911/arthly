// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { AssetClass, Instrument } from '../model/types.ts';
import type { FundConstituent, FundPortfolio } from '../plugins/prices/fund-holdings/types.ts';

import {
  emergencyFund,
  planning,
  rebalancePlan,
  splitNewMoney,
  validEmergencySettings,
  validPlanSettings,
} from './plan.ts';
import { summary } from './portfolio.ts';
import { PriceBook } from './prices.ts';
import { Ledger } from './testkit.ts';

function holdings() {
  const l = new Ledger()
    .member()
    .account({ id: 'a' })
    .instrument({
      id: 'fd',
      kind: 'fd',
      assetClass: 'debt',
      terms: {
        principal: 100_000,
        start: '2025-01-01',
        maturity: '2026-03-01',
        ratePct: 7,
        compounding: 'quarterly',
        payout: 'monthly',
      },
    })
    .txn({
      accountId: 'a',
      instrumentId: 'fd',
      date: '2025-01-01',
      type: 'contribution',
      amount: 100_000,
    });

  const add = (id: string, kind: Instrument['kind'], assetClass: AssetClass, value: number) => {
    l.instrument({ id, kind, assetClass });
    l.put('snapshot', {
      id: `s_${id}`,
      accountId: 'a',
      instrumentId: id,
      asOf: '2025-12-31',
      units: 1,
      value,
      invested: value,
      source: { kind: 'manual' },
    });
  };

  add('bank', 'cash', 'cash', 50_000);
  add('liquid', 'mf', 'cash', 30_000);
  add('gilt', 'mf', 'debt', 20_000);
  add('flexi', 'mf', 'equity', 200_000);

  return summary(l.state(), new PriceBook(), '2026-01-01').holdings;
}

describe('planning', () => {
  it('splits holdings by asset class, access and maturity', () => {
    const p = planning(holdings(), '2026-01-01');
    const slices = (b: typeof p.liquidity) => b.slices.map((s) => [s.label, s.value]);

    expect(p.total).toBe(400_000);
    expect(p.assetValues).toEqual({ cash: 80_000, debt: 120_000, equity: 200_000 });
    expect(slices(p.liquidity)).toEqual([
      ['Market-linked holdings', 250_000],
      ['Term deposits / bonds', 100_000],
      ['Bank / cash', 50_000],
    ]);
    expect(slices(p.maturities)).toEqual([['Next 90 days', 100_000]]);
  });

  it('counts bank cash, cash funds and FDs as emergency money, and nothing else', () => {
    const p = planning(holdings(), '2026-01-01', {}, { owedToYou: 25_000 });

    expect(p.emergency).toEqual({ cash: 50_000, cashFunds: 30_000, deposits: 100_000 });
    // Money you've lent shows in access to your money, but isn't emergency money or allocation.
    expect(p.liquidity.slices.find((s) => s.label === 'Owed to you')?.value).toBe(25_000);
    expect(p.total).toBe(400_000);
  });
});

describe('hybrid funds', () => {
  const report = (
    code: string,
    constituents: FundConstituent[],
    derivatives = false,
  ): FundPortfolio => ({
    id: `ppfas:${code}`,
    schemeName: `Scheme ${code}`,
    source: 'ppfas',
    sourceUrl: 'https://example.com/report.xls',
    asOf: '2026-09-30',
    reportedWeight: 1,
    derivatives,
    warnings: [],
    amfiCodes: [code],
    constituents,
  });
  const stock = (weight: number): FundConstituent => ({
    name: 'Stock',
    isin: 'INE001',
    kind: 'stock',
    assetClass: 'equity',
    weight,
  });
  const bond = (weight: number): FundConstituent => ({
    name: 'Bond',
    kind: 'debt',
    assetClass: 'debt',
    weight,
  });
  const reference = {
    schemes: [
      {
        code: '204',
        name: 'Example Hybrid Fund',
        category: 'Hybrid Scheme - Aggressive Hybrid Fund',
      },
    ],
    portfolios: [
      // Cash owed takes cash below zero, so it's left out and the rest scaled up.
      report(
        '201',
        [
          stock(0.6),
          bond(0.45),
          { name: 'Cash owed', kind: 'cash', assetClass: 'cash', weight: -0.05 },
        ],
        true,
      ),
      // An arbitrage fund's stocks are hedged: it counts as debt whatever it reports.
      report('202', [stock(0.7), { name: 'Cash', kind: 'cash', assetClass: 'cash', weight: 0.3 }]),
      // A nested hybrid fund without a report, and a 2% rounding gap.
      report('204', [
        stock(0.6),
        bond(0.28),
        { name: 'Unknown Hybrid Fund', kind: 'fund', assetClass: 'hybrid', weight: 0.1 },
      ]),
    ],
  };

  function funds() {
    const l = new Ledger().member().account({ id: 'a' }).account({ id: 'b' });

    const add = (
      id: string,
      name: string,
      amfi: string,
      value: number,
      assetClass: AssetClass = 'hybrid',
      accountId = 'a',
    ) => {
      l.instrument({ id, kind: 'mf', name, assetClass, ids: { amfi } });
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

    add('baf', 'Example Balanced Advantage Fund', '201', 100_000);
    add('arb', 'Example Arbitrage Fund', '202', 50_000);
    add('multi', 'Example Multi Asset Allocation Fund', '203', 30_000);
    add('multi', 'Example Multi Asset Allocation Fund', '203', 10_000, 'hybrid', 'b');
    add('agg', 'Example Hybrid Fund', '204', 10_000);
    // Marked Equity by hand: the class you chose wins.
    add('mine', 'Another Balanced Advantage Fund', '205', 20_000, 'equity');

    return planning(
      summary(l.state(), new PriceBook(), '2026-10-23').holdings,
      '2026-10-23',
      reference,
    );
  }

  it('splits hybrid funds into the classes they hold, leaving no Hybrid', () => {
    const p = funds();

    expect(p.total).toBe(220_000);
    expect(p.assetValues.hybrid).toBeUndefined();
    // Balanced advantage 4/7 and 3/7, multi-asset 50/30/20, the aggressive fund 67/31 of 98.
    expect(p.assetValues.equity).toBeCloseTo(400_000 / 7 + 20_000 + 6_700 / 0.98 + 20_000, 6);
    expect(p.assetValues.debt).toBeCloseTo(300_000 / 7 + 50_000 + 12_000 + 3_100 / 0.98, 6);
    expect(p.assetValues.gold).toBeCloseTo(8_000, 6);
  });

  it('says how each hybrid fund was split', () => {
    const p = funds();
    const fund = (name: string) => p.hybrid.find((f) => f.name.startsWith(name));

    expect(p.hybrid).toHaveLength(4);
    expect(fund('Example Balanced')).toMatchObject({
      method: 'report',
      type: 'Balanced advantage',
      asOf: '2026-09-30',
      hedged: true,
    });
    expect(fund('Example Balanced')?.split.equity).toBeCloseTo(4 / 7, 9);
    expect(fund('Example Arbitrage')).toMatchObject({
      method: 'arbitrage',
      split: { debt: 1 },
      hedged: false,
    });
    expect(fund('Example Multi')).toMatchObject({
      method: 'type',
      type: 'Multi-asset',
      value: 40_000,
      split: { equity: 0.5, debt: 0.3, gold: 0.2 },
    });
    // The type comes from the AMFI category when the name doesn't say.
    expect(fund('Example Hybrid')).toMatchObject({ method: 'report', type: 'Aggressive hybrid' });
    expect(fund('Another')).toBeUndefined();
  });
});

describe('rebalancing', () => {
  it('computes signed gaps to target, including the new money', () => {
    const p = rebalancePlan({ equity: 700, cash: 300 }, { equity: 60, cash: 40 }, 200);

    expect(p.valid).toBe(true);
    expect(p.rows.find((r) => r.assetClass === 'equity')).toMatchObject({
      targetValue: 720,
      change: 20,
    });
    expect(p.rows.find((r) => r.assetClass === 'cash')?.change).toBe(180);
  });

  it('flags classes that drift beyond the band', () => {
    const current = { equity: 700, cash: 300 };
    const targets = { equity: 60, cash: 40 };
    const five = rebalancePlan(current, targets, 0, 5);
    const equity = five.rows.find((r) => r.assetClass === 'equity')!;

    expect(equity.drift).toBeCloseTo(0.1);
    expect(equity.outside).toBe(true);
    expect(five.drifted).toBe(2);
    // Exactly on the band is still inside it.
    expect(rebalancePlan(current, targets, 0, 10).drifted).toBe(0);
    expect(rebalancePlan(current, targets, 0, 0).drifted).toBe(2);
    expect(rebalancePlan(current, { equity: 70, cash: 30 }, 0, 0).drifted).toBe(0);
  });

  it('puts new money into the classes furthest below target, never past it', () => {
    const current = { equity: 700, debt: 100, cash: 200 };
    const targets = { equity: 60, debt: 30, cash: 10 };
    const p = rebalancePlan(current, targets, 300);
    const row = (c: AssetClass) => p.rows.find((r) => r.assetClass === c)!;

    expect(row('debt').add).toBeCloseTo(266.67, 2);
    expect(row('equity').add).toBeCloseTo(33.33, 2);
    expect(row('cash').add).toBe(0);
    expect(p.rows.reduce((n, r) => n + r.add, 0)).toBeCloseTo(300, 6);
    // Both end at the same fraction of their target.
    expect(row('debt').after / 0.3).toBeCloseTo(row('equity').after / 0.6, 6);

    for (const r of p.rows) {
      expect(r.add).toBeLessThanOrEqual(Math.max(0, r.change) + 1e-6);
    }
  });

  it('fills every gap exactly when no class is over target', () => {
    expect(splitNewMoney({ equity: 500, debt: 500 }, { equity: 60, debt: 40 }, 1000)).toEqual({
      equity: 700,
      debt: 300,
    });
    expect(splitNewMoney({ equity: 500, debt: 500 }, { equity: 60, debt: 40 }, 0)).toEqual({});
  });

  it('splits by target with nothing held, and flags no drift', () => {
    const p = rebalancePlan({}, { equity: 70, debt: 30, gold: 0 }, 1000);

    expect(p.rows.find((r) => r.assetClass === 'equity')?.add).toBe(700);
    expect(p.rows.find((r) => r.assetClass === 'debt')?.add).toBe(300);
    expect(p.rows.find((r) => r.assetClass === 'gold')?.add).toBe(0);
    expect(p.drifted).toBe(0);
  });

  it('rejects bad targets, amounts and bands', () => {
    for (const targets of [
      { equity: 90 },
      { equity: -10, cash: 110 },
      { equity: NaN },
      { equity: 101 },
    ]) {
      expect(rebalancePlan({ equity: 100 }, targets).valid).toBe(false);
    }

    for (const [amount, band] of [
      [-1, 5],
      [NaN, 5],
      [0, -1],
      [0, 51],
      [0, NaN],
    ] as const) {
      expect(rebalancePlan({ equity: 100 }, { equity: 100 }, amount, band)).toMatchObject({
        valid: false,
        rows: [],
      });
    }

    expect(validPlanSettings({ mode: 'new-money', band: 5, amount: 0 })).toBe(true);
    expect(validPlanSettings({ mode: 'sell' as 'rebalance', band: 5, amount: 0 })).toBe(false);
  });
});

describe('emergency fund', () => {
  const money = { cash: 50_000, cashFunds: 30_000, deposits: 100_000 };

  it('shows months covered and the shortfall against the target', () => {
    expect(emergencyFund(money, { monthlyExpenses: 40_000, months: 6 })).toEqual({
      valid: true,
      available: 180_000,
      target: 240_000,
      months: 4.5,
      shortfall: 60_000,
      spare: 0,
    });
    expect(emergencyFund(money, { monthlyExpenses: 20_000, months: 6 })).toMatchObject({
      months: 9,
      shortfall: 0,
      spare: 60_000,
    });
  });

  it('counts the money until expenses are set', () => {
    expect(emergencyFund(money, null)).toMatchObject({ valid: false, available: 180_000 });

    for (const s of [
      { monthlyExpenses: 0, months: 6 },
      { monthlyExpenses: NaN, months: 6 },
      { monthlyExpenses: 1000, months: 0 },
      { monthlyExpenses: 1000, months: 37 },
    ]) {
      expect(validEmergencySettings(s)).toBe(false);
      expect(emergencyFund(money, s).valid).toBe(false);
    }
  });
});
