// SPDX-License-Identifier: AGPL-3.0-only
// Monthly portfolio reports someone downloads by hand, for fund houses the relay can't reach.
import { newestReports } from './collect.ts';
import { normaliseFundName, parseFundWorkbook } from './parse.ts';
import type { FundPortfolio } from './types.ts';

/** About forty consolidated workbooks' worth of schemes. */
const MAX_ADDED = 3000;

/**
 * Reads a fund house's monthly portfolio workbook, or a zip of them, the way a fetched report is
 * read. Schemes that can't be read are listed in `skipped`; the rest are kept.
 */
export async function readFundReport(
  name: string,
  bytes: Uint8Array,
  today: string,
): Promise<{ portfolios: FundPortfolio[]; skipped: string[] }> {
  const skipped: string[] = [];
  let portfolios: FundPortfolio[];
  try {
    portfolios = await parseFundWorkbook(bytes, { source: 'file', url: '', name }, (e) =>
      skipped.push(e.message),
    );
  } catch (error) {
    throw new Error(`${name} isn’t a monthly portfolio report the app can read`, {
      cause: error,
    });
  }
  if (portfolios.some((p) => p.asOf > today))
    throw new Error(`${name} is dated after today, so it can’t be used`);
  return { portfolios, skipped };
}

/** Adds newly read reports to the saved ones, keeping the newest report of each scheme. */
export function addFundReports(saved: FundPortfolio[], next: FundPortfolio[]): FundPortfolio[] {
  const all = [...newestReports([...saved, ...next]).values()];
  if (all.length > MAX_ADDED)
    throw new Error('Too many fund reports added. Remove the added reports, then add them again.');
  return all;
}

/**
 * The reports analytics uses: the fetched ones, with an added report taking the place of any
 * fetched report of the same scheme that is older. An added report as old as a fetched one isn't
 * used.
 */
export function withAddedReports(
  fetched: FundPortfolio[],
  added: FundPortfolio[],
): FundPortfolio[] {
  const scheme = (p: FundPortfolio) => normaliseFundName(p.schemeName);
  const newest = new Map<string, string>();
  for (const p of fetched)
    if (p.asOf > (newest.get(scheme(p)) ?? '')) newest.set(scheme(p), p.asOf);
  const used = added.filter((p) => p.asOf > (newest.get(scheme(p)) ?? ''));
  const replaced = new Set(used.map(scheme));
  return [...fetched.filter((p) => !replaced.has(scheme(p))), ...used];
}
