// SPDX-License-Identifier: AGPL-3.0-only
// The public price feed's files. The feed job writes them and the app reads them; all under /v1/.
import { sha256 } from '@noble/hashes/sha2.js';

import { toHex, utf8 } from '../../../util/bytes.ts';
import { addDays, endOfMonth, type ISODate } from '../../../util/dates.ts';

/** [amfiCode, isinGrowth, isinReinvest, name, category, nav, navDate] */
export type AmfiRow = [string, string, string, string, string, number, ISODate];
/** [symbol, series, isin, close] */
export type ExchangeRow = [string, string, string, number];

export interface AmfiFile {
  date: ISODate;
  rows: AmfiRow[];
}

export interface ExchangeFile {
  date: ISODate;
  /** 'nse', or 'bse' when NSE's file couldn't be fetched. */
  source: 'nse' | 'bse';
  rows: ExchangeRow[];
}

export interface FxFile {
  date: ISODate;
  USDINR: number;
}

/** key → [date, close][], daily for the last 400 days and month-end before that. */
export type HistoryGroup = Record<string, [ISODate, number][]>;

export interface Manifest {
  format: 1;
  generated: string;
  files: Record<string, { date: ISODate; sha256: string; size: number }>;
  /** Files carried over from an earlier run because their source failed today. */
  stale: string[];
}

export const FEED_PATHS = {
  manifest: 'v1/manifest.json',
  amfi: 'v1/latest/amfi.json.gz',
  exchange: 'v1/latest/nse.json.gz',
  reference: 'v1/latest/nse-reference.json.gz',
  fundHoldings: 'v1/latest/fund-holdings.json.gz',
  /** Every NSE and BSE index level, with their saved history. */
  indices: 'v1/latest/indices.json.gz',
  /** AMFI's stock categorisation: each listed company's cap size. */
  caps: 'v1/latest/caps.json.gz',
  fx: 'v1/latest/fx.json',
  ppfRates: 'v1/rates/ppf.json',
  epfRates: 'v1/rates/epf.json',
  history: (group: string) => `v1/history/${group}.json.gz`,
} as const;

/** The history group holding a key: the first byte of its SHA-256, as two hex digits. */
export function historyGroup(key: string): string {
  return toHex(sha256(utf8.encode(key)).subarray(0, 1));
}

export const DAILY_DAYS = 400;

/** Adds a close to a series kept in date order; a newer close for the same date replaces it. */
export function addPoint(series: [ISODate, number][], date: ISODate, close: number): void {
  const last = series.at(-1);

  if (last && last[0] === date) {
    last[1] = close;
  } else if (!last || last[0] < date) {
    series.push([date, close]);
  } else {
    const at = series.findIndex(([d]) => d >= date);

    if (series[at]![0] === date) {
      series[at]![1] = close;
    } else {
      series.splice(at, 0, [date, close]);
    }
  }
}

/** Keeps every day after the cut-off and only the last close of each earlier month. */
export function capSeries(series: [ISODate, number][], today: ISODate): [ISODate, number][] {
  const cutoff = addDays(today, -DAILY_DAYS);
  const out: [ISODate, number][] = [];

  for (const [i, point] of series.entries()) {
    const next = series[i + 1];

    if (point[0] >= cutoff) {
      out.push(point);
    } else if (!next || endOfMonth(next[0]) !== endOfMonth(point[0])) {
      out.push(point);
    }
  }

  return out;
}
