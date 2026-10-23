// SPDX-License-Identifier: AGPL-3.0-only
// Index and benchmark levels from NSE's and BSE's daily all-index files, kept apart from the
// prices of what you hold.
import type { ISODate } from '../../../util/dates.ts';

export type IndexProvider = 'nse' | 'bse';

/**
 * What a level measures. A price index leaves out dividends and a total return index puts them
 * back. A volatility index such as India VIX is not an investment return at all.
 */
export type ReturnBasis = 'price' | 'total' | 'net-total' | 'volatility' | 'unknown';

/** One series' published values for one day. Percentages are fractions: 0.0154 is 1.54%. */
export interface IndexObservation {
  /** Provider and series, such as "nse:nifty-50". Price and total return variants differ. */
  id: string;
  provider: IndexProvider;
  name: string;
  basis: ReturnBasis;
  currency: 'INR' | 'USD';
  /** The day the level is for, as published, not the day it was fetched. */
  date: ISODate;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  /** Points moved since the previous close. */
  change?: number;
  /** The same move as a fraction of the previous close. */
  changeRatio?: number;
  pe?: number;
  pb?: number;
  dividendYield?: number;
  /** Shares traded. */
  volume?: number;
  /** Value traded, in rupees. */
  turnover?: number;
}

export interface IndexSource {
  provider: IndexProvider;
  /** The newest file read, or the one tried when none could be read. */
  url: string;
  /** The date of that file; absent when none has ever been read. */
  date?: ISODate;
  /** Why the latest refresh couldn't read this source. */
  failure?: string;
}

export interface IndexDataFile {
  version: 1;
  /** The India date of the latest refresh. */
  date: ISODate;
  sources: IndexSource[];
  /** The newest observation of every series read so far, each with its own date. */
  series: IndexObservation[];
  /** Closing levels by series id, oldest first: daily for 400 days, month-end before that. */
  history: Record<string, [ISODate, number][]>;
  /** Rows left out of the latest files, and why. */
  warnings?: string[];
}
