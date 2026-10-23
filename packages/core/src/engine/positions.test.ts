// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../model/types.ts';
import { positions } from './positions.ts';
import { Ledger } from './testkit.ts';

const mf = () =>
  new Ledger()
    .member()
    .account({ id: 'acc_1', kind: 'mf' })
    .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } });

const snap = (asOf: string, units: number, invested: number, value: number): Snapshot => ({
  id: `snp_${asOf}`,
  accountId: 'acc_1',
  instrumentId: 'ins_1',
  asOf,
  units,
  invested,
  value,
  source: { kind: 'import', batchId: 'b1' },
});

describe('positions', () => {
  it('sells the oldest lots first', () => {
    const state = mf()
      .txn({ date: '2025-01-01', type: 'buy', units: 10, amount: 1_000 })
      .txn({ date: '2025-02-01', type: 'buy', units: 10, amount: 2_000 })
      .txn({ date: '2025-03-01', type: 'sell', units: 15, amount: 3_000 })
      .state();
    const [p] = positions(state, '2025-12-31');
    expect(p!.units).toBe(5);
    expect(p!.lots).toEqual([{ date: '2025-02-01', units: 5, cost: 1_000, costInr: 1_000 }]);
    expect(p!.cost).toBe(1_000);
    expect(p!.realised).toBe(3_000 - 2_000);
    expect(p!.flows).toEqual([
      { date: '2025-01-01', amount: -1_000 },
      { date: '2025-02-01', amount: -2_000 },
      { date: '2025-03-01', amount: 3_000 },
    ]);
  });

  it('stops at the given date', () => {
    const state = mf()
      .txn({ date: '2025-01-01', type: 'buy', units: 10, amount: 1_000 })
      .txn({ date: '2025-02-01', type: 'buy', units: 10, amount: 2_000 })
      .state();
    expect(positions(state, '2025-01-15')[0]!.units).toBe(10);
    expect(positions(state, '2024-12-31')).toEqual([]);
  });

  it('adds bonus units at zero cost and scales lots on a split', () => {
    const state = mf()
      .txn({ date: '2025-01-01', type: 'buy', units: 10, amount: 1_000 })
      .txn({ date: '2025-02-01', type: 'bonus', units: 10, amount: 0 })
      .txn({ date: '2025-03-01', type: 'split', units: 20, amount: 0 })
      .state();
    const [p] = positions(state, '2025-12-31');
    expect(p!.units).toBe(40);
    expect(p!.lots.map((l) => [l.date, l.units, l.cost])).toEqual([
      ['2025-01-01', 20, 1_000],
      ['2025-02-01', 20, 0],
    ]);
  });

  it('keeps reinvested dividends out of cash flows', () => {
    const state = mf()
      .txn({ date: '2025-01-01', type: 'buy', units: 10, amount: 1_000 })
      .txn({ date: '2025-06-01', type: 'dividend-reinvest', units: 1, amount: 110 })
      .txn({ date: '2025-07-01', type: 'dividend', amount: 50 })
      .state();
    const [p] = positions(state, '2025-12-31');
    expect(p!.units).toBe(11);
    expect(p!.cost).toBe(1_110);
    expect(p!.flows.map((f) => f.amount)).toEqual([-1_000, 50]);
  });

  it('builds an opening balance and changes from holdings snapshots', () => {
    const state = mf()
      .put('snapshot', snap('2026-01-31', 100, 10_000, 12_000))
      .put('snapshot', snap('2026-02-28', 110, 11_000, 13_200))
      .put('snapshot', snap('2026-03-31', 105, 10_500, 12_600))
      .state();
    const [p] = positions(state, '2026-12-31');
    expect(p!.estimate).toBe(true);
    expect(p!.units).toBe(105);
    expect(p!.entries.map((e) => [e.date, e.type, e.units, e.amount])).toEqual([
      ['2026-01-31', 'opening', 100, 10_000],
      ['2026-02-28', 'buy', 10, 1_000],
      ['2026-03-31', 'sell', 5, 600],
    ]);
  });

  it('dates the opening at the first-bought setting', () => {
    const state = mf()
      .put('snapshot', snap('2026-01-31', 100, 10_000, 12_000))
      .put('setting', { id: 'firstBought:acc_1|ins_1', value: '2023-05-01' })
      .state();
    expect(positions(state, '2026-12-31')[0]!.entries[0]!.date).toBe('2023-05-01');
  });

  it('drops the opening once transactions cover the holding', () => {
    const state = mf()
      .put('snapshot', snap('2026-01-31', 100, 10_000, 12_000))
      .txn({ date: '2025-01-01', type: 'buy', units: 100, amount: 10_000 })
      .state();
    const [p] = positions(state, '2026-12-31');
    expect(p!.estimate).toBe(false);
    expect(p!.entries).toHaveLength(1);
  });

  it('tracks balance holdings by principal and credited interest', () => {
    const state = new Ledger()
      .member()
      .account({ id: 'acc_1', kind: 'ppf' })
      .instrument({ id: 'ins_1', kind: 'ppf' })
      .put('snapshot', { ...snap('2025-03-31', 0, 400_000, 520_000) })
      .txn({ date: '2025-04-03', type: 'contribution', amount: 150_000 })
      .txn({ date: '2025-09-01', type: 'withdrawal', amount: 50_000 })
      .state();
    const [p] = positions(state, '2026-01-01');
    expect(p!.principal).toBe(500_000);
    expect(p!.credited).toBe(120_000);
    expect(p!.flows.map((f) => f.amount)).toEqual([-400_000, -150_000, 50_000]);
  });
});
