// SPDX-License-Identifier: AGPL-3.0-only
// Whole NSE index lists supply industries and cap-size proxies, never per-holding requests.
import { isISODate } from '../../util/dates.ts';

export type MarketCap = 'large' | 'mid' | 'small' | 'micro';

export interface StockReference {
  symbol: string;
  isin: string;
  industry: string;
  marketCap: MarketCap;
}

export interface NseReferenceFile {
  /** Retrieval date; oldest retained date when any bucket could not be refreshed. */
  date: string;
  rows: StockReference[];
  stale?: MarketCap[];
}

export const NSE_LISTS: Record<MarketCap, string> = {
  large: 'https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv',
  mid: 'https://nsearchives.nseindia.com/content/indices/ind_niftymidcap150list.csv',
  small: 'https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap250list.csv',
  micro: 'https://nsearchives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv',
};

/** The index each list belongs to, as named in NSE's daily index file. */
export const NSE_LIST_INDEX: Record<MarketCap, string> = {
  large: 'nse:nifty-100',
  mid: 'nse:nifty-midcap-150',
  small: 'nse:nifty-smallcap-250',
  micro: 'nse:nifty-microcap-250',
};

export function parseNseConstituents(text: string, marketCap: MarketCap): StockReference[] {
  // Preserve empty cells as well as commas inside quoted company names.
  const split = (line: string) => {
    const out: string[] = [];
    let cell = '',
      quoted = false;

    for (const ch of line) {
      if (ch === '"') {
        quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        out.push(cell.trim());
        cell = '';
      } else {
        cell += ch;
      }
    }

    out.push(cell.trim());

    return out;
  };

  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const head = split(lines[0] ?? '').map((s) => s.toLowerCase());
  const symbol = head.indexOf('symbol'),
    isin = head.indexOf('isin code'),
    industry = head.indexOf('industry');

  if ([symbol, isin, industry].some((n) => n < 0)) {
    throw new Error('NSE constituent headings have changed');
  }

  const rows = lines.slice(1).flatMap((line) => {
    const p = split(line);

    if (!p[symbol] || !p[isin]) {
      return [];
    }

    return [
      {
        symbol: p[symbol]!.toUpperCase(),
        isin: p[isin]!.toUpperCase(),
        industry: p[industry] ?? '',
        marketCap,
      },
    ];
  });

  if (!rows.length) {
    throw new Error('NSE constituent list is empty');
  }

  return rows;
}

export async function fetchNseReference(
  fetchText: (url: string) => Promise<string>,
  date: string,
  previous?: NseReferenceFile,
): Promise<NseReferenceFile> {
  const buckets = Object.keys(NSE_LISTS) as MarketCap[];
  const results = await Promise.allSettled(
    buckets.map(async (cap) => parseNseConstituents(await fetchText(NSE_LISTS[cap]), cap)),
  );
  const stale = buckets.filter((_, i) => results[i]!.status === 'rejected');
  const rows = results.flatMap((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : (previous?.rows.filter((s) => s.marketCap === buckets[i]) ?? []),
  );

  if (!rows.length) {
    throw new Error('NSE classification lists are unavailable');
  }

  // Defensive deduplication during index reconstitutions: larger cap bucket wins.
  const unique = new Map<string, StockReference>();

  for (const row of rows) {
    if (!unique.has(row.isin)) {
      unique.set(row.isin, row);
    }
  }

  return {
    date: stale.length && previous ? previous.date : date,
    rows: [...unique.values()],
    stale,
  };
}

/** Checks list data from the relay or the price feed before it is saved. */
export function validateNseReference(value: unknown): NseReferenceFile {
  const file = value as NseReferenceFile | null;
  const caps: unknown[] = Object.keys(NSE_LISTS);
  const text = (v: unknown, max: number, empty = false) =>
    typeof v === 'string' && v.length <= max && (empty || v.length > 0);

  if (
    !file ||
    !isISODate(file.date) ||
    !Array.isArray(file.rows) ||
    file.rows.length > 5000 ||
    (file.stale !== undefined &&
      (!Array.isArray(file.stale) || !file.stale.every((c) => caps.includes(c)))) ||
    !file.rows.every(
      (r) =>
        r &&
        text(r.symbol, 40) &&
        text(r.isin, 12) &&
        text(r.industry, 200, true) &&
        caps.includes(r.marketCap),
    )
  ) {
    throw new Error('Unexpected NSE list data');
  }

  return file;
}

/** Partial fresh lists replace their own buckets and retain saved unavailable buckets. */
export function mergeNseReference(
  next: NseReferenceFile | undefined,
  old: NseReferenceFile | undefined,
): NseReferenceFile | undefined {
  if (!next) {
    return old ? { ...old, stale: ['large', 'mid', 'small', 'micro'] } : undefined;
  }

  if (!old || !next.stale?.length) {
    return next;
  }

  const rows = [...next.rows, ...old.rows.filter((r) => next.stale!.includes(r.marketCap))];
  const unique = new Map<string, StockReference>();

  for (const row of rows) {
    if (!unique.has(row.isin)) {
      unique.set(row.isin, row);
    }
  }

  return { ...next, date: old.date < next.date ? old.date : next.date, rows: [...unique.values()] };
}
