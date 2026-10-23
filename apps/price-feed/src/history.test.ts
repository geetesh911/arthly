// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { historyGroup, type HistoryGroup } from '@pv/core/plugins/prices/feed/format.ts';
import { appendPrices, capSeries } from './history.ts';

describe('history groups', () => {
  it('spreads keys over 256 groups', () => {
    expect(historyGroup('amfi:147481')).toMatch(/^[0-9a-f]{2}$/);
    const groups = new Set(Array.from({ length: 2000 }, (_, i) => historyGroup(`amfi:${i}`)));
    expect(groups.size).toBe(256);
  });

  it('appends in date order and replaces a same-day price', () => {
    const groups = new Map<string, HistoryGroup>();
    appendPrices(groups, [
      { key: 'k', date: '2026-01-02', close: 2 },
      { key: 'k', date: '2026-01-01', close: 1 },
      { key: 'k', date: '2026-01-03', close: 3 },
      { key: 'k', date: '2026-01-03', close: 4 },
    ]);
    expect(groups.get(historyGroup('k'))!['k']).toEqual([
      ['2026-01-01', 1],
      ['2026-01-02', 2],
      ['2026-01-03', 4],
    ]);
  });

  it('keeps 400 days of daily prices and month-ends before that', () => {
    const series: [string, number][] = [
      ['2024-01-10', 1],
      ['2024-01-31', 2],
      ['2024-02-01', 3],
      ['2024-02-15', 4],
      ['2025-10-01', 5],
      ['2025-10-02', 6],
    ];
    expect(capSeries(series, '2026-10-22')).toEqual([
      ['2024-01-31', 2],
      ['2024-02-15', 4],
      ['2025-10-01', 5],
      ['2025-10-02', 6],
    ]);
  });
});
