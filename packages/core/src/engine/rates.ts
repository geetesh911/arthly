// SPDX-License-Identifier: AGPL-3.0-only
// Official PPF and EPF rates. The feed's rates/*.json replace these; check them against the
// Ministry of Finance (PPF, per quarter) and EPFO (EPF, per financial year) notifications.
import type { ISODate } from '../util/dates.ts';

export interface RateTables {
  /** PPF rate from each date on, in date order. */
  ppf: { from: ISODate; ratePct: number }[];
  /** EPF rate declared for each financial year (by starting year). */
  epf: { fy: number; ratePct: number }[];
}

export const DEFAULT_RATES: RateTables = {
  ppf: [
    { from: '2012-04-01', ratePct: 8.8 },
    { from: '2013-04-01', ratePct: 8.7 },
    { from: '2016-04-01', ratePct: 8.1 },
    { from: '2016-10-01', ratePct: 8.0 },
    { from: '2017-04-01', ratePct: 7.9 },
    { from: '2017-07-01', ratePct: 7.8 },
    { from: '2018-01-01', ratePct: 7.6 },
    { from: '2018-10-01', ratePct: 8.0 },
    { from: '2019-07-01', ratePct: 7.9 },
    { from: '2020-04-01', ratePct: 7.1 },
  ],
  epf: [
    { fy: 2012, ratePct: 8.5 },
    { fy: 2013, ratePct: 8.75 },
    { fy: 2014, ratePct: 8.75 },
    { fy: 2015, ratePct: 8.8 },
    { fy: 2016, ratePct: 8.65 },
    { fy: 2017, ratePct: 8.55 },
    { fy: 2018, ratePct: 8.65 },
    { fy: 2019, ratePct: 8.5 },
    { fy: 2020, ratePct: 8.5 },
    { fy: 2021, ratePct: 8.1 },
    { fy: 2022, ratePct: 8.15 },
    { fy: 2023, ratePct: 8.25 },
    { fy: 2024, ratePct: 8.25 },
  ],
};

/** The PPF rate for a date; before the table starts, its first rate. */
export function ppfRate(tables: RateTables, date: ISODate): number {
  let rate = tables.ppf[0]?.ratePct ?? 7.1;

  for (const row of tables.ppf) {
    if (row.from <= date) {
      rate = row.ratePct;
    }
  }

  return rate;
}

/** The EPF rate for a financial year; a year not declared yet uses the latest one. */
export function epfRate(tables: RateTables, fy: number): { ratePct: number; declared: boolean } {
  const exact = tables.epf.find((r) => r.fy === fy);

  if (exact) {
    return { ratePct: exact.ratePct, declared: true };
  }

  const earlier = tables.epf.filter((r) => r.fy < fy).sort((a, b) => a.fy - b.fy);

  return { ratePct: (earlier.at(-1) ?? tables.epf[0])?.ratePct ?? 8.25, declared: false };
}
