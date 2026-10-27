// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { deleteEvent, putEvent } from '../log/events.ts';
import { formatHlc } from '../log/hlc.ts';
import { replay } from '../log/replay.ts';
import type { Snapshot } from '../model/types.ts';

import { checks } from './checks.ts';
import { income } from './income.ts';
import { history, summary } from './portfolio.ts';
import { type Price, PriceBook } from './prices.ts';
import { Ledger } from './testkit.ts';
import { upcoming } from './upcoming.ts';

const price = (key: string, date: string, close: number): Price => ({
  key,
  date,
  close,
  currency: key.startsWith('us:') ? 'USD' : 'INR',
  source: 'test',
});

const family = () =>
  new Ledger()
    .member('mem_1', 'Asha')
    .member('mem_2', 'Ravi')
    .account({ id: 'acc_1', kind: 'mf', memberId: 'mem_1', institution: 'Groww' })
    .account({ id: 'acc_2', kind: 'mf', memberId: 'mem_2', institution: 'Groww' })
    .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
    .instrument({ id: 'ins_2', kind: 'etf', ids: { nse: 'GOLDBEES' }, assetClass: 'gold' })
    .txn({ date: '2025-01-01', type: 'buy', units: 10, amount: 1_000 })
    .txn({
      date: '2025-01-01',
      type: 'buy',
      units: 100,
      amount: 5_000,
      accountId: 'acc_2',
      instrumentId: 'ins_2',
    });

const book = new PriceBook([
  price('amfi:1', '2026-01-01', 150),
  price('nse:GOLDBEES', '2026-01-01', 60),
]);

describe('summary', () => {
  it('adds up value, gain and XIRR', () => {
    const s = summary(family().state(), book, '2026-01-01');

    expect(s.netWorth).toBe(7_500);
    expect(s).toMatchObject({ invested: 6_000, gain: 1_500, realised: 0, netInvested: 6_000 });
    expect(s.xirr).toBeCloseTo(0.25, 6);
    expect(s.absoluteReturn).toBeCloseTo(0.25, 6);
    expect(s.allocation.assetClass).toEqual({ equity: 1_500, gold: 6_000 });
    expect(s.allocation.member).toEqual({ mem_1: 1_500, mem_2: 6_000 });
    const [top] = s.holdings;

    expect(top).toMatchObject({ value: 6_000, invested: 5_000, gain: 1_000, weight: 0.8 });
    expect(top!.xirr).toBeCloseTo(0.2, 6);
  });

  it('gives a holding no XIRR until it is a year old', () => {
    const young = summary(family().state(), book, '2025-12-31');

    expect(young.holdings.every((h) => h.xirr === null)).toBe(true);
    expect(summary(family().state(), book, '2026-01-01').holdings[0]!.xirr).not.toBeNull();
  });

  it('filters by member and group', () => {
    const l = family().put('group', {
      id: 'grp_1',
      name: 'All Weather',
      holdings: [{ instrumentId: 'ins_2' }],
    });

    expect(summary(l.state(), book, '2026-01-01', { memberId: 'mem_1' }).netWorth).toBe(1_500);
    const grouped = summary(l.state(), book, '2026-01-01', { groupId: 'grp_1' });

    expect(grouped.netWorth).toBe(6_000);
    expect(summary(l.state(), book, '2026-01-01').allocation.group).toEqual({
      grp_1: 6_000,
      '': 1_500,
    });
  });

  it('counts the gain on a holding sold in full as realised', () => {
    const l = family().txn({ date: '2025-06-01', type: 'sell', units: 10, amount: 1_200 });
    const s = summary(l.state(), book, '2026-01-01');

    expect(s.holdings.map((h) => h.instrument.id)).toEqual(['ins_2']);
    expect(s.netWorth).toBe(6_000);
    expect(s).toMatchObject({ invested: 5_000, gain: 1_000, realised: 200 });
    expect(s.netInvested).toBe(6_000 - 1_200);
  });

  it('matches the holdings for invested and gain, with sales and payouts as realised', () => {
    const l = family().txn({ date: '2025-06-01', type: 'sell', units: 4, amount: 520 }).txn({
      date: '2025-08-01',
      type: 'dividend',
      amount: 50,
      accountId: 'acc_2',
      instrumentId: 'ins_2',
    });
    const s = summary(l.state(), book, '2026-01-01');
    const sum = (key: 'invested' | 'gain') => s.holdings.reduce((n, h) => n + h[key], 0);

    // 4 of 10 units that cost 1,000 sold for 520, and a dividend of 50.
    expect(s).toMatchObject({ invested: 5_600, gain: 1_300, realised: 120 + 50 });
    expect(s.invested).toBe(sum('invested'));
    expect(s.gain).toBe(sum('gain'));
    expect(s.gain + s.realised).toBe(s.investments - s.netInvested);
    expect(s.absoluteReturn).toBeCloseTo(1_300 / 5_600, 6);
  });

  it('assumes payouts of a payout FD were paid, for XIRR', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'bank' })
      .instrument({
        id: 'ins_1',
        kind: 'fd',
        assetClass: 'debt',
        terms: {
          principal: 100_000,
          start: '2025-01-01',
          maturity: '2027-01-01',
          ratePct: 7.2,
          compounding: 'quarterly',
          payout: 'monthly',
        },
      })
      .txn({ date: '2025-01-01', type: 'contribution', amount: 100_000 });
    const s = summary(l.state(), new PriceBook(), '2026-01-01');

    expect(s.holdings[0]!.value).toBe(100_000);
    expect(s.holdings[0]!.flows).toHaveLength(13);
    expect(s.xirr!).toBeGreaterThan(0.072);
    expect(s.xirr!).toBeLessThan(0.0745);
  });

  it('converts US holdings at the USD→INR rate', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'demat', currency: 'USD' })
      .instrument({ id: 'ins_1', kind: 'us-stock', currency: 'USD', ids: { us: 'VTI' } })
      .txn({ date: '2025-01-01', type: 'buy', units: 2, amount: 500, currency: 'USD', fx: 85 });
    const usd = new PriceBook([
      price('us:VTI', '2026-01-01', 300),
      price('fx:USDINR', '2026-01-01', 90),
    ]);
    const s = summary(l.state(), usd, '2026-01-01');

    expect(s.netWorth).toBe(54_000);
    expect(s.netInvested).toBe(42_500);
    expect(s.holdings[0]!.invested).toBe(42_500);
  });

  it('marks XIRR as an estimate when an opening balance comes from a snapshot', () => {
    const snap: Snapshot = {
      id: 'snp_1',
      accountId: 'acc_1',
      instrumentId: 'ins_1',
      asOf: '2025-06-01',
      units: 5,
      invested: 500,
      value: 600,
      source: { kind: 'manual' },
    };
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'mf' })
      .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
      .put('snapshot', snap);

    expect(summary(l.state(), book, '2026-01-01').xirrEstimate).toBe(true);
  });

  it('measures XIRR for a holdings file from its value that day, not its cost', () => {
    // Bought for 500 at some unknown time; worth 600 on the file's date; 750 a year later.
    const snap: Snapshot = {
      id: 'snp_1',
      accountId: 'acc_1',
      instrumentId: 'ins_1',
      asOf: '2025-01-01',
      units: 5,
      invested: 500,
      value: 600,
      source: { kind: 'manual' },
    };
    const ledger = () =>
      new Ledger()
        .member()
        .account({ id: 'acc_1', kind: 'mf' })
        .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
        .put('snapshot', snap);
    const s = summary(ledger().state(), book, '2026-01-01');

    expect(s.holdings[0]).toMatchObject({ invested: 500, gain: 250, gainPct: 0.5 });
    expect(s.holdings[0]!.xirr).toBeCloseTo(0.25, 6);
    expect(s.xirr).toBeCloseTo(0.25, 6);
    expect(s.netInvested).toBe(500);
    // Told when it was first bought, the cost counts from then.
    const dated = ledger().put('setting', { id: 'firstBought:acc_1|ins_1', value: '2024-01-01' });

    expect(summary(dated.state(), book, '2026-01-01').holdings[0]!.xirr).toBeCloseTo(
      Math.sqrt(1.5) - 1,
      3,
    );
  });

  it('values EPF at the interest credited, and measures its XIRR to the last credit', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'epf' })
      .instrument({ id: 'ins_1', kind: 'epf', assetClass: 'debt' })
      .txn({ date: '2024-03-01', type: 'contribution', amount: 10_000 });
    const at = (date: string) => summary(l.state(), book, date).holdings[0]!;

    // A year old, but with nothing credited yet there is no return to measure.
    expect(at('2025-03-15')).toMatchObject({ value: 10_000, xirr: null });

    l.txn({ date: '2025-03-31', type: 'interest', amount: 825 });
    const h = at('2025-10-15');

    expect(h).toMatchObject({ value: 10_825, gain: 825, xirrTo: '2025-03-31' });
    expect(h.xirr).toBeCloseTo(1.0825 ** (365 / 395) - 1, 4);
  });
});

describe('history', () => {
  it('carries the latest price forward and uses cost before any price', () => {
    const prices = new PriceBook([
      price('amfi:1', '2025-03-15', 120),
      price('amfi:1', '2025-05-10', 130),
    ]);
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'mf' })
      .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
      .txn({ date: '2025-01-10', type: 'buy', units: 10, amount: 1_000 });
    const points = history(l.state(), prices, '2025-01-01', '2025-06-15', { step: 'month' });

    expect(points.map((p) => [p.date, p.value, p.costOnly])).toEqual([
      ['2025-01-31', 1_000, true],
      ['2025-02-28', 1_000, true],
      ['2025-03-31', 1_200, false],
      ['2025-04-30', 1_200, false],
      ['2025-05-31', 1_300, false],
      ['2025-06-15', 1_300, false],
    ]);
    expect(history(l.state(), prices, '2025-01-01', '2025-01-03', { step: 'day' })).toHaveLength(3);
  });

  it('shows as invested the cost of what was held, not what a sale brought in', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'mf' })
      .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
      .txn({ date: '2025-01-10', type: 'buy', units: 10, amount: 1_000 })
      .txn({ date: '2025-03-10', type: 'sell', units: 5, amount: 900 });
    const points = history(l.state(), new PriceBook(), '2025-01-01', '2025-03-31', {
      step: 'month',
    });

    expect(points.map((p) => [p.date, p.invested])).toEqual([
      ['2025-01-31', 1_000],
      ['2025-02-28', 1_000],
      ['2025-03-31', 500],
    ]);
  });
});

describe('income and upcoming', () => {
  const ppfAndFd = () =>
    new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'ppf' })
      .account({ id: 'acc_2', kind: 'bank' })
      .instrument({ id: 'ins_1', kind: 'ppf', assetClass: 'debt' })
      .instrument({
        id: 'ins_2',
        kind: 'fd',
        assetClass: 'debt',
        terms: {
          principal: 100_000,
          start: '2025-01-01',
          maturity: '2026-01-01',
          ratePct: 7.1,
          compounding: 'quarterly',
          payout: 'cumulative',
        },
      })
      .txn({ date: '2025-04-03', type: 'contribution', amount: 150_000 })
      .txn({
        date: '2025-01-01',
        type: 'contribution',
        amount: 100_000,
        accountId: 'acc_2',
        instrumentId: 'ins_2',
      })
      .txn({
        date: '2025-08-01',
        type: 'dividend',
        amount: 75,
        accountId: 'acc_2',
        instrumentId: 'ins_2',
      });

  it('reports interest received and accrued per financial year', () => {
    const rows = income(ppfAndFd().state(), new PriceBook(), 2025);
    const ppfRow = rows.find((r) => r.instrumentId === 'ins_1')!;

    expect(ppfRow).toMatchObject({ type: 'interest', taxFree: true, estimated: true });
    expect(ppfRow.received).toBeCloseTo(10_650, 6);
    expect(ppfRow.accrued).toBeCloseTo(10_650, 6);
    const fdRow = rows.find((r) => r.instrumentId === 'ins_2' && r.type === 'interest')!;

    expect(fdRow.received).toBe(0);
    const full = 107_291.28 - 100_000;

    expect(fdRow.accrued).toBeGreaterThan(full * 0.7);
    expect(fdRow.accrued).toBeLessThan(full);
    expect(rows.find((r) => r.type === 'dividend')).toMatchObject({ received: 75 });
  });

  it('lists maturities and the PPF deadline', () => {
    const items = upcoming(ppfAndFd().state(), new PriceBook(), '2025-12-15', 120);

    expect(items.map((u) => [u.date, u.kind, u.instrumentId])).toEqual([
      ['2026-01-01', 'maturity', 'ins_2'],
      ['2026-03-31', 'credit', 'ins_1'],
      ['2026-03-31', 'ppf-deadline', 'ins_1'],
    ]);
    expect(items[0]!.amount).toBeCloseTo(107_291.28, 2);
    expect(items[2]!.amount).toBe(0);
  });
});

describe('checks', () => {
  const types = (list: { type: string }[]) => list.map((c) => c.type).sort();

  it('flags stale and missing prices, and no backup', () => {
    const list = checks(
      family().state(),
      new PriceBook([price('amfi:1', '2025-12-20', 150)]),
      '2026-01-01',
    );

    expect(types(list)).toEqual(['backup.none', 'price.stale', 'price.stale']);
    expect(list.find((c) => c.instrumentId === 'ins_2')!.message).toContain('no price yet');
    expect(checks(family().state(), book, '2026-01-01', { lastBackup: '2025-12-30' })).toEqual([]);
  });

  it('flags old holdings files and holdings missing from the latest one', () => {
    const snap = (id: string, asOf: string, batchId: string): Snapshot => ({
      id,
      accountId: 'acc_1',
      instrumentId: 'ins_1',
      asOf,
      units: 10,
      source: { kind: 'import', batchId },
    });
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'mf' })
      .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
      .import({
        batchId: 'b1',
        memberId: 'mem_1',
        asOf: '2025-10-31',
        puts: [{ entity: 'snapshot', id: 'snp_a', value: snap('snp_a', '2025-10-31', 'b1') }],
      })
      .import({ batchId: 'b2', memberId: 'mem_1', asOf: '2025-11-30', puts: [] });
    const fresh = new PriceBook([price('amfi:1', '2026-01-09', 150)]);
    const list = checks(l.state(), fresh, '2026-01-10', { lastSync: '2026-01-09' });

    expect(types(list)).toEqual(['file.stale', 'recon.missing']);
    expect(list.find((c) => c.type === 'recon.missing')!.fix).toEqual({
      kind: 'record-sell',
      ref: 'acc_1|ins_1',
    });
  });

  it('flags units that differ from the holdings file, and duplicates', () => {
    const l = family()
      .put('snapshot', {
        id: 'snp_1',
        accountId: 'acc_1',
        instrumentId: 'ins_1',
        asOf: '2025-12-31',
        units: 12,
        source: { kind: 'manual' },
      })
      .txn({
        date: '2025-01-01',
        type: 'buy',
        units: 10,
        amount: 1_000.5,
        source: { kind: 'import', batchId: 'b9' },
      });
    const list = checks(l.state(), book, '2026-01-01', { lastSync: '2026-01-01' });

    expect(types(list)).toEqual(['dup.txn', 'recon.units']);
  });

  it('compares a PPF statement with the credited balance, not interest still accruing', () => {
    const ppf = (statement: number) =>
      new Ledger()
        .member()
        .account({ id: 'acc_1', kind: 'ppf' })
        .instrument({ id: 'ins_1', kind: 'ppf', assetClass: 'debt' })
        .txn({ date: '2025-04-03', type: 'contribution', amount: 100_000 })
        .put('snapshot', {
          id: 'snp_1',
          accountId: 'acc_1',
          instrumentId: 'ins_1',
          asOf: '2025-09-30',
          units: statement,
          value: statement,
          source: { kind: 'manual' },
        });
    const found = (statement: number) =>
      types(checks(ppf(statement).state(), book, '2025-10-01', { lastSync: '2025-10-01' }));

    expect(found(100_000)).toEqual([]);
    expect(found(90_000)).toEqual(['recon.units']);
  });

  it('flags PPF limits, matured FDs and sync conflicts, and honours dismissals', () => {
    const l = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'ppf' })
      .instrument({ id: 'ins_1', kind: 'ppf', assetClass: 'debt' })
      .txn({ date: '2025-04-03', type: 'contribution', amount: 160_000 });
    const list = checks(l.state(), book, '2025-06-01', { lastSync: '2025-06-01' });

    expect(types(list)).toEqual(['ppf.limit']);
    l.put('dismissal', { id: 'dis_1', checkKey: list[0]!.key });
    expect(checks(l.state(), book, '2025-06-01', { lastSync: '2025-06-01' })).toEqual([]);

    const low = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'ppf' })
      .instrument({ id: 'ins_1', kind: 'ppf', assetClass: 'debt' })
      .txn({ date: '2024-04-03', type: 'contribution', amount: 1_000 });

    expect(types(checks(low.state(), book, '2026-03-05', { lastSync: '2026-03-05' }))).toEqual([
      'balance.stale',
      'ppf.minimum',
    ]);

    const events = [
      ...family().all(),
      putEvent(
        formatHlc(1_800_000_000_000, 0, 'aaaaaaaa'),
        'member',
        { id: 'mem_1', name: 'A' },
        'x',
      ),
      deleteEvent(formatHlc(1_800_000_000_001, 0, 'bbbbbbbb'), 'member', 'mem_2', 'y'),
    ];
    const conflicts = checks(replay(events), book, '2026-01-01', { lastSync: '2026-01-01' });

    expect(types(conflicts)).toEqual(['sync.conflict', 'sync.conflict']);
  });
});
