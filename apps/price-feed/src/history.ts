// SPDX-License-Identifier: AGPL-3.0-only
// History groups: daily prices for the last 400 days and month-end prices before that.
import {
  addPoint,
  capSeries,
  historyGroup,
  type HistoryGroup,
} from '@pv/core/plugins/prices/feed/format.ts';

export { capSeries };

/** Adds today's prices into their groups. A newer price for the same date replaces the old one. */
export function appendPrices(
  groups: Map<string, HistoryGroup>,
  prices: Iterable<{ key: string; date: string; close: number }>,
): void {
  for (const p of prices) {
    const name = historyGroup(p.key);
    const group = groups.get(name) ?? {};
    groups.set(name, group);
    addPoint((group[p.key] ??= []), p.date, p.close);
  }
}

export function capGroups(groups: Map<string, HistoryGroup>, today: string): void {
  for (const group of groups.values()) {
    for (const key of Object.keys(group)) group[key] = capSeries(group[key]!, today);
  }
}
