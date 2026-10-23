// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { IndexDataFile, IndexObservation } from '../plugins/prices/indices/types.ts';
import { benchmarks } from './benchmarks.ts';

const obs = (id: string, date: string, close: number, extra = {}): IndexObservation => ({
  id,
  provider: id.startsWith('bse') ? 'bse' : 'nse',
  name: id,
  basis: 'price',
  currency: 'INR',
  date,
  close,
  ...extra,
});

const file: IndexDataFile = {
  version: 1,
  date: '2026-10-23',
  sources: [
    { provider: 'nse', url: 'https://nse/22', date: '2026-10-22' },
    { provider: 'bse', url: 'https://bse/21', date: '2026-10-21', failure: 'Refused' },
  ],
  series: [
    obs('nse:nifty-auto', '2026-10-22', 110),
    obs('nse:nifty-50', '2026-10-22', 120),
    obs('nse:nifty-gone', '2026-10-20', 10),
    obs('nse:india-vix', '2026-10-22', 15, { basis: 'volatility' }),
    obs('bse:sensex', '2026-10-21', 70000),
  ],
  history: {
    'nse:nifty-50': [
      ['2025-10-20', 100],
      ['2026-09-18', 110],
      ['2026-10-22', 120],
    ],
    'nse:nifty-auto': [
      ['2026-09-10', 100],
      ['2026-10-22', 110],
    ],
    'nse:india-vix': [
      ['2025-10-22', 10],
      ['2026-10-22', 15],
    ],
  },
};

describe('benchmarks', () => {
  const view = benchmarks(file, { 'nse:nifty-auto': 15 });
  const row = (id: string) => view.rows.find((r) => r.id === id)!;

  it('puts headline indices first, then the rest in file order', () => {
    expect(view.rows.map((r) => r.id)).toEqual([
      'nse:nifty-50',
      'bse:sensex',
      'nse:india-vix',
      'nse:nifty-auto',
      'nse:nifty-gone',
    ]);
  });

  it('works out changes only from a saved close near the start of the period', () => {
    // There's no close on 22 Sep; 18 Sep is four days earlier, which is close enough.
    expect(row('nse:nifty-50').month).toBeCloseTo(120 / 110 - 1);
    // 22 Oct 2025 is two days after the saved 20 Oct close.
    expect(row('nse:nifty-50').year).toBeCloseTo(0.2);
    expect(row('nse:nifty-auto')).not.toHaveProperty('month');
    expect(row('nse:nifty-auto')).not.toHaveProperty('year');
    expect(row('nse:nifty-50').since).toBe('2025-10-20');
    // A volatility level is not a return.
    expect(row('nse:india-vix')).not.toHaveProperty('year');
  });

  it('flags levels older than their exchange’s newest file', () => {
    expect(row('nse:nifty-gone').retained).toBe(true);
    expect(row('nse:nifty-50').retained).toBe(false);
    // BSE failed, so its levels are from its last good file, which the source line says.
    expect(row('bse:sensex').retained).toBe(false);
    expect(view.sources).toEqual([
      {
        provider: 'nse',
        label: 'NSE',
        page: 'https://www.niftyindices.com/reports/daily-reports',
        url: 'https://nse/22',
        date: '2026-10-22',
        count: 4,
      },
      {
        provider: 'bse',
        label: 'BSE',
        page: 'https://www.bseindia.com/indices/IndexArchiveData.html',
        url: 'https://bse/21',
        date: '2026-10-21',
        failure: 'Refused',
        count: 1,
      },
    ]);
  });

  it('shows how many members NSE lists, where known', () => {
    expect(row('nse:nifty-auto').members).toBe(15);
    expect(row('nse:nifty-50')).not.toHaveProperty('members');
  });

  it('is empty before any index data is loaded', () => {
    expect(benchmarks(undefined)).toEqual({ sources: [], rows: [], warnings: [] });
  });
});
