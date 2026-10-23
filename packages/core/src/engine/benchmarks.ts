// SPDX-License-Identifier: AGPL-3.0-only
// Index and benchmark levels for the Analytics screen, with changes over a period only where
// saved closes of the same series reach back that far.
import { INDEX_SOURCES } from '../plugins/prices/indices/data.ts';
import type {
  IndexDataFile,
  IndexObservation,
  IndexSource,
} from '../plugins/prices/indices/types.ts';
import { addDays, addMonths, addYears, type ISODate } from '../util/dates.ts';

export interface BenchmarkRow extends IndexObservation {
  /** Change over about a month and a year, as fractions; absent without a saved close then. */
  month?: number;
  year?: number;
  /** The first saved close. */
  since: ISODate;
  /** Missing from its exchange's newest file, so the level is from an earlier one. */
  retained: boolean;
  /** Members in NSE's constituent list; their weights aren't published. */
  members?: number;
}

export interface Benchmarks {
  sources: (IndexSource & { label: string; page: string; count: number })[];
  rows: BenchmarkRow[];
  warnings: string[];
}

/** Broad benchmarks most people compare against, shown before the rest. */
const HEADLINE = [
  'nse:nifty-50',
  'bse:sensex',
  'nse:nifty-next-50',
  'nse:nifty-100',
  'nse:nifty-500',
  'bse:bse500',
  'nse:nifty-midcap-150',
  'nse:nifty-smallcap-250',
  'nse:nifty-total-market',
  'nse:nifty-bank',
  'nse:nifty-10-yr-benchmark-g-sec',
  'nse:india-vix',
];

/** The saved close on or up to a week before `from`, which allows for holidays. */
function closeNear(points: [ISODate, number][], from: ISODate): number | undefined {
  const earliest = addDays(from, -7);

  for (let i = points.length - 1; i >= 0; i--) {
    const [date, close] = points[i]!;

    if (date <= from) {
      return date >= earliest ? close : undefined;
    }
  }

  return undefined;
}

export function benchmarks(
  file: IndexDataFile | undefined,
  members: Partial<Record<string, number>> = {},
): Benchmarks {
  if (!file) {
    return { sources: [], rows: [], warnings: [] };
  }

  const newest = new Map(file.sources.map((s) => [s.provider, s.date]));

  const rank = (id: string) => {
    const at = HEADLINE.indexOf(id);

    return at < 0 ? HEADLINE.length : at;
  };

  const rows = file.series
    .map((s, order) => ({ s, order }))
    .sort((a, b) => rank(a.s.id) - rank(b.s.id) || a.order - b.order)
    .map(({ s }): BenchmarkRow => {
      const points = file.history[s.id] ?? [];
      const row: BenchmarkRow = {
        ...s,
        since: points[0]?.[0] ?? s.date,
        retained: s.date < (newest.get(s.provider) ?? s.date),
      };

      if (['price', 'total', 'net-total'].includes(s.basis)) {
        const month = closeNear(points, addMonths(s.date, -1));
        const year = closeNear(points, addYears(s.date, -1));

        if (month) {
          row.month = s.close / month - 1;
        }

        if (year) {
          row.year = s.close / year - 1;
        }
      }

      if (members[s.id] !== undefined) {
        row.members = members[s.id]!;
      }

      return row;
    });

  return {
    sources: file.sources.map((s) => ({
      ...s,
      label: INDEX_SOURCES[s.provider].label,
      page: INDEX_SOURCES[s.provider].page,
      count: file.series.filter((r) => r.provider === s.provider).length,
    })),
    rows,
    warnings: file.warnings ?? [],
  };
}
