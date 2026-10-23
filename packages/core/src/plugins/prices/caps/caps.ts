// SPDX-License-Identifier: AGPL-3.0-only
// AMFI's stock categorisation: every listed company's cap size as SEBI defines it for mutual
// funds. The 100 largest by six-month average market value are large caps, the next 150 mid
// caps and the rest small caps. AMFI publishes the whole list every January and July.
import { isISODate, makeDate } from '../../../util/dates.ts';
import { fetchAllowed } from '../../../util/http.ts';

export type CapSize = 'large' | 'mid' | 'small';

export interface CapRow {
  isin: string;
  /** NSE symbol, when the company trades there. */
  nse?: string;
  cap: CapSize;
}

export interface CapFile {
  version: 1;
  /** Retrieval date. */
  date: string;
  /** The last day of the six months the averages cover. */
  asOf: string;
  url: string;
  rows: CapRow[];
  warnings?: string[];
}

export const AMFI_CAPS_PAGE = 'https://www.amfiindia.com/otherdata/categorisation-of-stocks';
// The June 2026 list is 0.6 MB; the page is 0.2 MB.
export const MAX_CAPS_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20_000;
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; Arthly stock categorisation)' };
const HOSTS = ['portal.amfiindia.com', 'www.amfiindia.com'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ISIN = /^IN[A-Z0-9]{10}$/;

/** A day such as "30 June 2026" or "30Jun2026", as an ISO date. */
function day(d: string, month: string, year: string): string | undefined {
  const m = MONTHS.indexOf(month.slice(0, 3).toLowerCase()) + 1;
  const date = m ? makeDate(Number(year), m, Number(d)) : '';
  return isISODate(date) ? date : undefined;
}

/** The period end in a list's file name, when it's an AMFI list on an AMFI host. */
function fileDate(value: string): string | undefined {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !HOSTS.includes(u.hostname)) return undefined;
    if (u.username || u.password || u.search || u.hash) return undefined;
    // "AverageMarketCapitalization30Jun2026.xlsx", or with "oflisted…ended" before the date.
    const m = /^AverageMarketCapitalization[a-z]*?(\d{1,2})([a-z]{3,9})(\d{4})\.xlsx$/i.exec(
      decodeURIComponent(u.pathname.split('/').at(-1) ?? ''),
    );
    return m ? day(m[1]!, m[2]!, m[3]!) : undefined;
  } catch {
    return undefined;
  }
}

export const isAmfiCapsUrl = (value: string) => fileDate(value) !== undefined;

/** The newest list linked from AMFI's page, published by `today`. */
export function findAmfiCapsUrl(html: string, today: string): string {
  const links = [...html.matchAll(/https:\/\/[^"'<>\s\\]+?\.xlsx/gi)].map((m) => m[0]);
  const dated = links.flatMap((url) => {
    const date = fileDate(url);
    return date && date <= today ? [{ url, date }] : [];
  });
  const newest = dated.sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!newest) throw new Error('AMFI’s page has no cap list');
  return newest.url;
}

/** Finds the newest list on AMFI's page and starts downloading it. */
export async function fetchAmfiCaps(
  fetcher: typeof fetch,
  today: string,
): Promise<{ url: string; response: Response }> {
  const page = await fetchAllowed(fetcher, AMFI_CAPS_PAGE, {
    allowed: (u) => new URL(u).origin === new URL(AMFI_CAPS_PAGE).origin,
    limit: MAX_PAGE_BYTES,
    headers: HEADERS,
    noun: 'AMFI page',
  });
  const url = findAmfiCapsUrl(await page.text(), today);
  const response = await fetchAllowed(fetcher, url, {
    allowed: isAmfiCapsUrl,
    limit: MAX_CAPS_BYTES,
    headers: HEADERS,
    noun: 'cap list',
  });
  return { url, response };
}

/** Reads AMFI's workbook; `date` is when it was retrieved. */
export async function parseAmfiCaps(
  bytes: Uint8Array,
  url: string,
  date: string,
): Promise<CapFile> {
  if (!isAmfiCapsUrl(url)) throw new Error('Unapproved cap list URL');
  if (bytes.length > MAX_CAPS_BYTES) throw new Error('AMFI’s cap list is too large');
  // An xlsx file is a zip; an error page isn't.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('AMFI’s cap list isn’t a workbook');
  const XLSX = await import('xlsx');
  const book = XLSX.read(bytes, {
    type: 'array',
    sheets: 0,
    sheetRows: MAX_ROWS,
    cellFormula: false,
    cellHTML: false,
  });
  const sheet = book.Sheets[book.SheetNames[0] ?? ''];
  if (!sheet) throw new Error('AMFI’s cap list has no sheet');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const text = (v: unknown) => String(v ?? '').trim();
  const head = rows.findIndex(
    (r) =>
      r.some((c) => /^isin$/i.test(text(c))) && r.some((c) => /categori[sz]ation/i.test(text(c))),
  );
  const cols = (rows[head] ?? []).map((c) => text(c).toLowerCase());
  const isin = cols.indexOf('isin'),
    nse = cols.findIndex((c) => c.startsWith('nse symbol')),
    category = cols.findIndex((c) => /categori[sz]ation/.test(c));
  if (head < 0 || nse < 0) throw new Error('AMFI cap list headings have changed');
  // "…during the six months ended 30 June 2026"
  const title = rows
    .slice(0, head)
    .flat()
    .map(text)
    .map((t) => /ended\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{4})/i.exec(t))
    .find(Boolean);
  const asOf = (title ? day(title[1]!, title[2]!, title[3]!) : undefined) ?? fileDate(url);
  if (!asOf || asOf > date) throw new Error('AMFI’s cap list has no period');

  const found = new Map<string, CapRow>();
  const conflicts = new Set<string>();
  let malformed = 0;
  for (const r of rows.slice(head + 1)) {
    const id = text(r[isin]).toUpperCase();
    const label = text(r[category]);
    if (!id && !label) continue;
    const cap: CapSize | undefined = /^large/i.test(label)
      ? 'large'
      : /^mid/i.test(label)
        ? 'mid'
        : /^small/i.test(label)
          ? 'small'
          : undefined;
    if (!ISIN.test(id) || !cap) {
      malformed++;
      continue;
    }
    const symbol = text(r[nse]).toUpperCase();
    const seen = found.get(id);
    if (seen && seen.cap !== cap) conflicts.add(id);
    else if (!seen)
      found.set(id, { isin: id, ...(symbol && symbol !== '-' ? { nse: symbol } : {}), cap });
  }
  for (const id of conflicts) found.delete(id);
  if (!found.size) throw new Error('AMFI’s cap list has no companies');

  const list = [...found.values()];
  const count = (cap: CapSize) => list.filter((r) => r.cap === cap).length;
  const warnings = [
    ...(count('large') !== 100 || count('mid') !== 150
      ? [`The list has ${count('large')} large and ${count('mid')} mid caps, not 100 and 150`]
      : []),
    ...(malformed ? [`${malformed} rows have no valid ISIN or category`] : []),
    ...(conflicts.size ? [`${conflicts.size} ISINs are listed twice with different sizes`] : []),
  ];
  return { version: 1, date, asOf, url, rows: list, ...(warnings.length ? { warnings } : {}) };
}

/** Checks a list from the price feed or the encrypted cache before it's used. */
export function validateAmfiCaps(value: unknown): CapFile {
  const f = value as CapFile | null;
  const caps: unknown[] = ['large', 'mid', 'small'];
  const short = (v: unknown, max: number) =>
    typeof v === 'string' && v.length > 0 && v.length <= max;
  if (
    !f ||
    f.version !== 1 ||
    !isISODate(f.date) ||
    !isISODate(f.asOf) ||
    f.asOf > f.date ||
    typeof f.url !== 'string' ||
    !isAmfiCapsUrl(f.url) ||
    !Array.isArray(f.rows) ||
    !f.rows.length ||
    f.rows.length > MAX_ROWS ||
    !f.rows.every(
      (r) =>
        r &&
        typeof r.isin === 'string' &&
        ISIN.test(r.isin) &&
        (r.nse === undefined || short(r.nse, 40)) &&
        caps.includes(r.cap),
    ) ||
    (f.warnings !== undefined &&
      (!Array.isArray(f.warnings) ||
        f.warnings.length > 20 ||
        !f.warnings.every((w) => short(w, 300))))
  )
    throw new Error('Unexpected cap list data');
  return f;
}
