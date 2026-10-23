// SPDX-License-Identifier: AGPL-3.0-only
import { isISODate } from '../../../util/dates.ts';
import { parseFundWorkbook } from './parse.ts';
import { FUND_SOURCES, isFundWorkbookUrl, MAX_FUND_FILE_BYTES } from './sources.ts';
import type {
  FundDisclosureFile,
  FundDisclosureIndex,
  FundHoldingsFile,
  FundPortfolio,
} from './types.ts';

/**
 * One refresh downloads at most this much in all, to bound browser memory and data use. A new
 * month's reports from every AMC come to about 60 MB; saved months aren't fetched again.
 */
const MAX_REFRESH_BYTES = 128 * 1024 * 1024;
const MAX_REFRESH_MS = 300_000;
const MAX_FILES = 600;
/** Workbooks downloaded and parsed at a time, to bound browser memory. */
const PARALLEL = 4;

/** The newest report of each scheme, by id; of two with the same date, the later one. */
export function newestReports(portfolios: FundPortfolio[]): Map<string, FundPortfolio> {
  const latest = new Map<string, FundPortfolio>();
  for (const p of portfolios) {
    const old = latest.get(p.id);
    if (!old || p.asOf >= old.asOf) latest.set(p.id, p);
  }
  return latest;
}

export function mergeFundHoldings(
  next: FundHoldingsFile | undefined,
  previous?: FundHoldingsFile,
): FundHoldingsFile {
  if (!next)
    return {
      version: 1,
      date: previous?.date ?? '',
      portfolios: previous?.portfolios ?? [],
      retained: previous?.portfolios.map((p) => p.id) ?? [],
      failures: [
        {
          source: 'disclosures',
          message: 'Could not refresh fund portfolios; using any saved disclosures.',
        },
      ],
    };
  const latest = newestReports([...(previous?.portfolios ?? []), ...next.portfolios]);
  const brought = new Set(next.portfolios.map((p) => p.id));
  const kept = new Set(next.retained);
  return {
    ...next,
    portfolios: [...latest.values()],
    retained: [...latest.keys()].filter((id) => kept.has(id) || !brought.has(id)),
  };
}

/** Downloads all files in the public manifest, never a subset based on investor holdings. */
export async function collectFundHoldings(
  index: FundDisclosureIndex,
  download: (file: FundDisclosureFile) => Promise<Uint8Array>,
  previous?: FundHoldingsFile,
  force = false,
): Promise<FundHoldingsFile> {
  if (index.version !== 1 || !isISODate(index.date) || index.files.length > MAX_FILES)
    throw new Error('Unexpected fund disclosure manifest');
  const fresh: FundPortfolio[] = [];
  const failures = [...index.failures];
  let bytesRead = 0;
  const started = Date.now();
  for (let offset = 0; offset < index.files.length; offset += PARALLEL) {
    const files = index.files.slice(offset, offset + PARALLEL);
    const results = await Promise.allSettled(
      files.map(async (file) => {
        if (!isFundWorkbookUrl(file.url)) throw new Error('Unapproved portfolio URL');
        if (Date.now() - started > MAX_REFRESH_MS || bytesRead > MAX_REFRESH_BYTES)
          throw new Error('Fund refresh limit reached; retry to update remaining reports');
        const cached = previous?.portfolios.filter((p) => p.sourceUrl === file.url) ?? [];
        if (cached.length && !force) return { portfolios: cached, skipped: [] };
        const bytes = await download(file);
        bytesRead += bytes.byteLength;
        if (bytes.byteLength > MAX_FUND_FILE_BYTES || bytesRead > MAX_REFRESH_BYTES)
          throw new Error('Fund workbook download is too large');
        // A scheme that can't be read doesn't cost the rest of a consolidated workbook.
        const skipped: string[] = [];
        const portfolios = await parseFundWorkbook(bytes, file, (e) => skipped.push(e.message));
        if (portfolios.some((p) => p.asOf > index.date))
          throw new Error('Fund report has a future portfolio date');
        return { portfolios, skipped };
      }),
    );
    for (let n = 0; n < results.length; n++) {
      const r = results[n]!;
      const file = files[n]!;
      if (r.status === 'rejected') {
        failures.push({
          source: file.source,
          message: `${file.name}: ${(r.reason as Error).message}`,
        });
        continue;
      }
      fresh.push(...r.value.portfolios);
      const { skipped } = r.value;
      if (skipped.length)
        failures.push({
          source: file.source,
          message: `${file.name}: ${skipped.length === 1 ? 'one scheme' : `${skipped.length} schemes`} couldn’t be read (${skipped[0]})`,
        });
    }
  }
  return mergeFundHoldings({ version: 1, date: index.date, portfolios: fresh, failures }, previous);
}

/** Guard JSON feed responses before analytics reads them. */
export function validateFundHoldings(value: unknown): FundHoldingsFile {
  const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((s) => typeof s === 'string');
  const optionalStrings = (v: unknown) => v === undefined || strings(v);
  const file = value as FundHoldingsFile | null;
  if (
    !file ||
    file.version !== 1 ||
    !isISODate(file.date) ||
    !Array.isArray(file.portfolios) ||
    file.portfolios.length > 3000 ||
    !optionalStrings(file.retained) ||
    !Array.isArray(file.failures) ||
    file.failures.some((f) => !f || typeof f.source !== 'string' || typeof f.message !== 'string')
  )
    throw new Error('Unexpected fund holdings data');
  const kinds = ['stock', 'debt', 'cash', 'commodity', 'fund', 'other'];
  const classes = ['equity', 'debt', 'hybrid', 'gold', 'silver', 'cash', 'other'];
  for (const p of file.portfolios) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      typeof p.schemeName !== 'string' ||
      !Object.hasOwn(FUND_SOURCES, p.source) ||
      !optionalStrings(p.amfiCodes) ||
      !optionalStrings(p.schemeIsins) ||
      typeof p.derivatives !== 'boolean' ||
      !Number.isFinite(p.reportedWeight) ||
      !isISODate(p.asOf) ||
      p.asOf > file.date ||
      !isFundWorkbookUrl(p.sourceUrl) ||
      !Array.isArray(p.constituents) ||
      p.constituents.length > 5000 ||
      !strings(p.warnings)
    )
      throw new Error('Invalid fund portfolio');
    for (const c of p.constituents)
      if (
        !c ||
        typeof c.name !== 'string' ||
        !Number.isFinite(c.weight) ||
        Math.abs(c.weight) > 1.02 ||
        !kinds.includes(c.kind) ||
        !classes.includes(c.assetClass) ||
        (c.weight < 0 && c.kind !== 'cash') ||
        (c.isin !== undefined && typeof c.isin !== 'string') ||
        (c.industry !== undefined && typeof c.industry !== 'string') ||
        (c.amfi !== undefined && typeof c.amfi !== 'string')
      )
        throw new Error('Invalid fund constituent');
    const sum = p.constituents.reduce((n, c) => n + c.weight, 0);
    if (Math.abs(sum - 1) > 0.020001) throw new Error('Incomplete fund portfolio');
  }
  return file;
}
