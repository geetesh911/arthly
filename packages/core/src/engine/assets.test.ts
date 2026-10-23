// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { all } from '../log/replay.ts';
import type { DepositTerms } from '../model/types.ts';
import { assetTypeFor } from '../plugins/assets/index.ts';
import { cumulativeValue, payoutSchedule } from '../plugins/assets/deposit/index.ts';
import { couponDates } from '../plugins/assets/bond/index.ts';
import { ppfMaturity } from '../plugins/assets/ppf/index.ts';
import type { AssetContext } from './asset-type.ts';
import { positions } from './positions.ts';
import { PriceBook } from './prices.ts';
import { DEFAULT_RATES } from './rates.ts';
import { Ledger } from './testkit.ts';

function ctx(
  date: string,
  book = new PriceBook(),
  snaps: AssetContext['snapshots'] = () => [],
): AssetContext {
  return { date, prices: book, rates: DEFAULT_RATES, snapshots: snaps };
}

function only(l: Ledger, date: string) {
  const state = l.state();
  const [p] = positions(state, date);
  const i = all(state, 'instrument')[0]!;
  return { p: p!, i, type: assetTypeFor(i.kind) };
}

const fd = (t: Partial<DepositTerms>): DepositTerms => ({
  principal: 100_000,
  start: '2025-01-01',
  maturity: '2026-01-01',
  ratePct: 7.1,
  compounding: 'quarterly',
  payout: 'cumulative',
  ...t,
});

describe('deposit', () => {
  it('compounds quarterly: ₹1,00,000 at 7.1% for a year is ₹1,07,291.28', () => {
    expect(cumulativeValue(fd({}), '2026-01-01')).toBeCloseTo(107_291.28, 2);
    expect(cumulativeValue(fd({}), '2030-01-01')).toBeCloseTo(107_291.28, 2);
    expect(cumulativeValue(fd({}), '2024-06-01')).toBe(100_000);
  });

  it('adds simple interest for a part period', () => {
    const value = cumulativeValue(fd({}), '2025-05-01');
    const quarter = 100_000 * (1 + 0.071 / 4);
    expect(value).toBeCloseTo(quarter * (1 + (0.071 * 30) / 365), 6);
  });

  it('pays monthly payouts on schedule, with a pro-rata last period', () => {
    const schedule = payoutSchedule(
      fd({ payout: 'monthly', start: '2026-01-31', maturity: '2026-05-15' }),
    );
    expect(schedule.map((s) => s.date)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-15',
    ]);
    expect(schedule[0]!.amount).toBeCloseTo((100_000 * 0.071) / 12, 6);
    expect(schedule[3]!.amount).toBeCloseTo((100_000 * 0.071 * 15) / 365, 6);
  });

  it('shows a matured FD at its maturity value until the payout is recorded', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'bank' })
      .instrument({ id: 'ins_1', kind: 'fd', assetClass: 'debt', terms: fd({}) })
      .txn({ date: '2025-01-01', type: 'contribution', amount: 100_000 });
    const open = only(l, '2025-07-01');
    expect(open.type.value(open.p, open.i, ctx('2025-07-01')).status).toBe('open');
    const matured = only(l, '2026-02-01');
    expect(matured.type.value(matured.p, matured.i, ctx('2026-02-01'))).toMatchObject({
      status: 'matured',
      value: expect.closeTo(107_291.28, 2),
    });
    l.txn({ date: '2026-01-02', type: 'maturity', amount: 107_291.28 });
    const closed = only(l, '2026-02-01');
    expect(closed.type.value(closed.p, closed.i, ctx('2026-02-01'))).toMatchObject({
      status: 'closed',
      value: 0,
    });
  });

  it('lists payouts and the maturity as coming up', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'bank' })
      .instrument({ id: 'ins_1', kind: 'fd', terms: fd({ payout: 'quarterly' }) })
      .txn({ date: '2025-01-01', type: 'contribution', amount: 100_000 });
    const { p, i, type } = only(l, '2025-03-01');
    const flows = type.projected!(p, i, '2025-03-01', '2026-01-31', ctx('2025-03-01'));
    expect(flows.map((f) => [f.date, f.kind])).toEqual([
      ['2025-04-01', 'payout'],
      ['2025-07-01', 'payout'],
      ['2025-10-01', 'payout'],
      ['2026-01-01', 'payout'],
      ['2026-01-01', 'maturity'],
    ]);
    expect(type.accrued!(p, i, '2024-12-31', '2025-12-31', ctx('2025-03-01'))).toBeCloseTo(
      (100_000 * 0.071 * 364) / 365,
      6,
    );
  });
});

describe('bond and SGB', () => {
  const sgb = {
    faceValue: 5_000,
    couponPct: 2.5,
    couponFreq: 2 as const,
    issue: '2021-03-09',
    maturity: '2029-03-09',
  };

  it('pays SGB coupons twice a year for 8 years', () => {
    const dates = couponDates(sgb);
    expect(dates).toHaveLength(16);
    expect(dates[0]).toBe('2021-09-09');
    expect(dates.at(-1)).toBe('2029-03-09');
  });

  it('uses the market price when listed, else face value plus accrued coupon', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'demat' })
      .instrument({
        id: 'ins_1',
        kind: 'sgb',
        assetClass: 'gold',
        ids: { isin: 'IN0020200344' },
        terms: sgb,
      })
      .txn({ date: '2021-03-09', type: 'buy', units: 10, amount: 50_000 });
    const { p, i, type } = only(l, '2026-10-21');
    const unlisted = type.value(p, i, ctx('2026-10-21'));
    expect(unlisted.estimate).toBe(true);
    expect(unlisted.value).toBeCloseTo(10 * (5_000 + (5_000 * 0.025 * 42) / 365), 4);
    const book = new PriceBook([
      {
        key: 'isin:IN0020200344',
        date: '2026-10-20',
        close: 12_000,
        currency: 'INR',
        source: 'nse',
      },
    ]);
    expect(type.value(p, i, ctx('2026-10-21', book))).toMatchObject({
      value: 120_000,
      priceDate: '2026-10-20',
    });
    const coupons = type.projected!(p, i, '2026-10-21', '2027-04-01', ctx('2026-10-21'));
    expect(coupons).toEqual([{ date: '2027-03-09', amount: 625, kind: 'coupon', estimated: true }]);
  });
});

describe('PPF', () => {
  const base = () =>
    new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'ppf' })
      .instrument({ id: 'ins_1', kind: 'ppf', assetClass: 'debt' });

  it('earns on the lowest balance from the 5th, credited on 31 March', () => {
    const early = base().txn({ date: '2025-04-03', type: 'contribution', amount: 150_000 });
    const a = only(early, '2026-03-31');
    expect(a.type.value(a.p, a.i, ctx('2026-03-31')).value).toBeCloseTo(150_000 + 10_650, 6);

    const late = base().txn({ date: '2025-04-10', type: 'contribution', amount: 150_000 });
    const b = only(late, '2026-03-31');
    expect(b.type.value(b.p, b.i, ctx('2026-03-31')).value).toBeCloseTo(150_000 + 887.5 * 11, 6);
  });

  it('shows interest accrued since 1 April', () => {
    const l = base().txn({ date: '2025-04-03', type: 'contribution', amount: 150_000 });
    const { p, i, type } = only(l, '2025-06-30');
    expect(type.value(p, i, ctx('2025-06-30'))).toMatchObject({
      value: 150_000 + 887.5 * 3,
      estimate: true,
    });
  });

  it('uses the interest credited in the passbook instead of the estimate', () => {
    const l = base()
      .txn({ date: '2025-04-03', type: 'contribution', amount: 150_000 })
      .txn({ date: '2026-03-31', type: 'interest', amount: 10_600 });
    const { p, i, type } = only(l, '2026-03-31');
    expect(type.value(p, i, ctx('2026-03-31'))).toMatchObject({ value: 160_600, estimate: false });
  });

  it('matures 15 years after the end of the year it was opened', () => {
    const l = base().txn({ date: '2015-06-10', type: 'contribution', amount: 1000 });
    const { p, i } = only(l, '2026-01-01');
    expect(ppfMaturity(p, i)).toBe('2031-03-31');
  });
});

describe('EPF and EPS', () => {
  it('earns from the month after a contribution, credited on 31 March', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'epf' })
      .instrument({ id: 'ins_1', kind: 'epf', assetClass: 'debt' })
      .txn({
        date: '2025-04-30',
        type: 'contribution',
        amount: 10_000,
        meta: { part: 'employee' },
      });
    const { p, i, type } = only(l, '2026-03-31');
    expect(type.value(p, i, ctx('2026-03-31')).value).toBeCloseTo(
      10_000 + ((10_000 * 8.25) / 1200) * 11,
      6,
    );
  });

  it('values EPS at its contributions', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'epf' })
      .instrument({ id: 'ins_1', kind: 'eps', assetClass: 'debt' })
      .txn({ date: '2025-04-30', type: 'contribution', amount: 1_250 })
      .txn({ date: '2025-05-31', type: 'contribution', amount: 1_250 });
    const { p, i, type } = only(l, '2026-03-31');
    expect(type.value(p, i, ctx('2026-03-31')).value).toBe(2_500);
  });
});

describe('market', () => {
  it('uses units × price and falls back to cost', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'mf' })
      .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '147481' } })
      .txn({ date: '2025-01-01', type: 'buy', units: 100, amount: 5_000 });
    const { p, i, type } = only(l, '2026-01-01');
    expect(type.value(p, i, ctx('2026-01-01'))).toMatchObject({ value: 5_000, estimate: true });
    const book = new PriceBook(
      [{ key: 'amfi:147481', date: '2025-12-31', close: 80, currency: 'INR', source: 'amfi' }],
      [{ id: 'mp', instrumentId: 'ins_1', date: '2025-12-30', price: 70 }],
    );
    expect(type.value(p, i, ctx('2026-01-01', book))).toMatchObject({
      value: 8_000,
      priceDate: '2025-12-31',
    });
    const manual = new PriceBook(
      [{ key: 'amfi:147481', date: '2025-12-31', close: 80, currency: 'INR', source: 'amfi' }],
      [{ id: 'mp', instrumentId: 'ins_1', date: '2025-12-31', price: 90 }],
    );
    expect(type.value(p, i, ctx('2026-01-01', manual)).value).toBe(9_000);
  });
});
