// SPDX-License-Identifier: AGPL-3.0-only
import type { WorkSheet } from 'xlsx';
import { unzip } from '../../../import/zip.ts';
import { MAX_FUND_FILE_BYTES } from './sources.ts';
import type { FundConstituent, FundPortfolio, FundReportFile } from './types.ts';

const MAX_SHEETS = 256;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 64;
const ROUNDING_TOLERANCE = 0.02;
const clean = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** Remove plan/option suffixes, without removing scheme words such as Growth Fund. */
export function normaliseFundName(name: string): string {
  return clean(name)
    .toLowerCase()
    .replace(/\(\s*an? (?:open|close|closed)[\s-]ended[\s\S]*$/i, '')
    .replace(/\(\s*existing number of segregated portfolios\s*-\s*\d+\s*\)/g, '')
    .replace(/\(\s*(?:formerly|erstwhile)\b[^)]*\)/g, '')
    .replace(/\bfund of funds?\b(?:\s*\(\s*fof\s*\))?/g, 'fof')
    .replace(/[–—-]/g, ' ')
    .replace(/\b(?:direct|regular)(?:\s+plan)?\b[\s\S]*$/i, '')
    .replace(
      /\s+(?:growth(?:\s+option)?|(?:daily|weekly|monthly|quarterly|annual)?\s*(?:idcw|dividend)(?:\s+(?:option|payout|reinvestment|reinvest))*|income distribution cum capital withdrawal)\s*$/i,
      '',
    )
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH =
  '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)';
function disclosureDate(text: string, monthOnly: boolean): string | undefined {
  const first = text.match(
    new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?[\\s,/-]+(20\\d{2})\\b`, 'i'),
  );
  const last = text.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s,/-]+${MONTH}[\\s,/-]+(20\\d{2})\\b`, 'i'),
  );
  const monthYear = monthOnly ? text.match(new RegExp(`\\b${MONTH}\\s+(20\\d{2})\\b`, 'i')) : null;
  const monthName = first?.[1] ?? last?.[2] ?? monthYear?.[1];
  // Tata writes the day first in figures: "30-09-26".
  const figures = /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/.exec(text);
  let year: number, month: number, day: number;
  if (monthName) {
    year = Number(first?.[3] ?? last?.[3] ?? monthYear?.[2]);
    month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
    day = Number(first?.[2] ?? last?.[1] ?? new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  } else if (figures) {
    year = Number(figures[3]) + (figures[3]!.length === 2 ? 2000 : 0);
    month = Number(figures[2]) - 1;
    day = Number(figures[1]);
  } else return undefined;
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

function number(value: unknown): number | undefined {
  const text = clean(value)
    .replace(/[$,%@#*£]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return undefined;
  const result = Number(text);
  return Number.isFinite(result) ? result : undefined;
}

function classify(
  name: string,
  isin: string | undefined,
  section: string,
): Pick<FundConstituent, 'kind' | 'assetClass'> {
  const cash =
    /net (?:current|receivable)|payable|\bcash\b|treps|\brepo\b|^trp_|^rep\d_|clearing corporation/i;
  if (cash.test(name) || cash.test(section)) return { kind: 'cash', assetClass: 'cash' };
  const fund =
    isin?.startsWith('INF') ||
    /\betfs?\b|exchange[ -]traded funds?/i.test(name) ||
    /mutual fund|exchange traded funds|fund units|corporate debt market development fund/i.test(
      section,
    );
  if (fund)
    return {
      kind: 'fund',
      assetClass: /silver/i.test(name)
        ? 'silver'
        : /gold/i.test(name)
          ? 'gold'
          : /debt|bond|liquid|gilt/i.test(name)
            ? 'debt'
            : /equity|nifty|sensex/i.test(name)
              ? 'equity'
              : 'other',
    };
  if (
    /debt|money market|certificate of deposit|commercial paper|treasury|t-?bill|government securit|bonds|securitis|term deposits/i.test(
      section,
    )
  )
    return { kind: 'debt', assetClass: 'debt' };
  if (/\bgold\b|\bsilver\b/i.test(section))
    return { kind: 'commodity', assetClass: /silver/i.test(section) ? 'silver' : 'gold' };
  if (
    /\breits?\b|real estate trust|realty trust|infrastructure investment trust|\binvits?\b/i.test(
      `${section} ${name}`,
    )
  )
    return { kind: 'other', assetClass: 'other' };
  if (/equity|arbitrage|(?:foreign|overseas) (?:investments|securities)/i.test(section))
    return { kind: 'stock', assetClass: 'equity' };
  return { kind: 'other', assetClass: 'other' };
}

interface Columns {
  name: number;
  isin: number;
  weight: number;
  market: number;
  industry: number;
}
function columns(row: string[]): Columns | undefined {
  const name = row.findIndex((c) => /name.*(?:instrument|security)/i.test(c));
  const isin = row.findIndex((c) => /^isin(?: code)?$/i.test(c));
  const weight = row.findIndex((c) => /%|percent/i.test(c) && /nav|net assets|aum/i.test(c));
  if (name < 0 || isin < 0 || weight < 0) return undefined;
  const first = (...patterns: RegExp[]) =>
    patterns.map((re) => row.findIndex((c) => re.test(c))).find((i) => i >= 0) ?? -1;
  return {
    name,
    isin,
    weight,
    market: first(/market.*value|fair.*value|mkt\.? val/i),
    // Quant has separate Rating and Industry columns; others share one.
    industry: first(/industry/i, /rating/i),
  };
}
const total = (row: string[]) =>
  row.some((c) => /^(?:grand total(?:\s*\(aum\))?|net assets)$/i.test(c));
const subtotal = (text: string) => /^(?:sub\s*total|total)(?:\s*\([^)]*\))?$/i.test(text);
// Tata's, in the name column: "EQUITY & EQUITY RELATED TOTAL", "NON-CONVERTIBLE DEBENTURES/BONDS
// TOTAL", "FOREIGN SECURITIES AND /OR OVERSEAS ETF(S) TOTAL".
const namedTotal = (text: string) => /^[a-z &/,'()-]+ total$/i.test(text);
const derivativeHeading = (text: string) =>
  /^(?:derivatives?(?: disclosure table)?|interest rate swaps|irs|futures|options)$/i.test(text);

function parseSheet(
  rows: string[][],
  sheetName: string,
  file: FundReportFile,
): FundPortfolio | undefined {
  // A consolidated index has names and links, never a holdings header.
  if (/^(?:index|summary|contents?)$/i.test(sheetName)) return undefined;
  const headerIndex = rows.slice(0, 40).findIndex((row) => columns(row));
  if (headerIndex < 0) {
    // Risk-o-meters, dividend histories and top-10 summaries have no holdings table, but a
    // sheet that lists ISINs is a portfolio whose headings changed.
    if (rows.some((row) => row.some((c) => /^IN[A-Z0-9]{9}\d$/.test(c))))
      throw new Error(`${sheetName}: portfolio table headings have changed`);
    return undefined;
  }
  const cols = columns(rows[headerIndex]!)!;
  const preamble = rows.slice(0, headerIndex).flat();
  // "Monthly portfolio statement of X for September 2026", or Edelweiss's
  // "PORTFOLIO STATEMENT OF X AS ON SEPTEMBER 30, 2026".
  const statement = /^(?:monthly )?portfolio statement of\s+/i;
  const title =
    preamble.find((c) => statement.test(c)) ??
    preamble.find(
      (c) =>
        /\b(?:fund|etf|bees|fmp|fof|fixed maturity plan)\b/i.test(c) &&
        !/statement|mutual fund$/i.test(c),
    );
  if (!title) throw new Error(`${sheetName}: missing scheme name`);
  let schemeName = title
    .replace(statement, '')
    .replace(/\s*\(\s*an? (?:open|close|closed)[\s-]ended[\s\S]*$/i, '');
  // A date after "as on" is the only date, so "Bharat Bond ETF – April 2030" keeps its year.
  if (statement.test(title))
    schemeName = /\s+as on\b/i.test(schemeName)
      ? schemeName.replace(/\s+as on\b[\s\S]*$/i, '')
      : schemeName.replace(new RegExp(`\\s+(?:for\\s+)?${MONTH}\\s+20\\d{2}\\s*$`, 'i'), '');
  schemeName = schemeName.trim();
  if (!schemeName) throw new Error(`${sheetName}: missing scheme name`);
  // Whole rows, since SBI puts the date in the cell after "PORTFOLIO STATEMENT AS ON :".
  const asOf = rows
    .slice(0, headerIndex)
    .map((row) => row.filter(Boolean).join(' '))
    .filter((text) => /(?:as on|portfolio statement)/i.test(text))
    .map((text) => disclosureDate(text, file.source === 'zerodha'))
    .find(Boolean);
  if (!asOf) throw new Error(`${sheetName}: missing or invalid portfolio date`);
  const end = rows.findIndex((row, i) => i > headerIndex && total(row));
  if (end < 0) throw new Error(`${sheetName}: missing grand total; incomplete portfolio`);
  const totalNAV = number(rows[end]?.[cols.market]);
  if (totalNAV === undefined || totalNAV <= 0)
    throw new Error(`${sheetName}: invalid grand total net assets`);
  const constituents: FundConstituent[] = [];
  const warnings: string[] = [];
  let section = '';
  let inDerivatives = false;
  let derivativeWeight = 0;
  let previous = '';
  const repeated = new Set<number>();
  let groupMarket = 0;
  let groupWeight = 0;
  let groupCount = 0;
  const resetGroup = () => {
    groupMarket = 0;
    groupWeight = 0;
    groupCount = 0;
  };
  // Marks a footnote defines as a tiny weight: "@ Less than 0.01%", "# -> Less Than 0.005%".
  const tinyMarks = new Set(
    rows
      .flat()
      .flatMap((c) =>
        [...c.matchAll(/([@*#])\s*(?:->|-|:)?\s*less than\s*0\.0\d*\s*%/gi)].map((m) => m[1]!),
      ),
  );
  const derivatives = rows.some((row) => row.some(derivativeHeading));
  for (let i = headerIndex + 1; i < end; i++) {
    const row = rows[i]!;
    const name = row[cols.name] ?? '';
    const texts = row.filter(Boolean);
    if (!texts.length) continue;
    if (texts.some(subtotal)) {
      resetGroup();
      continue;
    }
    const rawIsin = (row[cols.isin] ?? '').toUpperCase();
    const isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(rawIsin) ? rawIsin : undefined;
    const value = number(row[cols.market]);
    const weightText = row[cols.weight] ?? '';
    const numericWeight = number(weightText);
    if (value === undefined && !isin && (numericWeight === undefined || numericWeight === 0)) {
      resetGroup();
      const heading = name || texts.join(' ');
      if (derivativeHeading(heading)) {
        inDerivatives = true;
        continue;
      }
      // Generic listing/unlisted subheads inherit their surrounding asset class.
      if (
        /equity|arbitrage|debt|money market|certificate|commercial paper|treasury|t-?bill|repo|treps|\breits?\b|\binvits?\b|gold|silver|fund|foreign|overseas|\betfs?\b|others|current assets|receivable|deposit|government securit/i.test(
          heading,
        )
      ) {
        section = heading;
        inDerivatives = false;
      }
      continue;
    }
    if (namedTotal(name) && !isin) {
      resetGroup();
      continue;
    }
    // Cash is never a derivative, so it ends the section even without a heading.
    if (inDerivatives && classify(name, isin, '').kind === 'cash') inDerivatives = false;
    if (inDerivatives) {
      // Bank of India writes these weights as fractions, so the market value decides.
      if (name || isin)
        derivativeWeight += value !== undefined ? value / totalNAV : (numericWeight ?? 0) / 100;
      continue;
    }
    // Some Zerodha section subtotals have no label. Only accept a row consisting
    // entirely of the two totals, and verify both against the preceding section.
    if (
      !name &&
      !isin &&
      value !== undefined &&
      numericWeight !== undefined &&
      groupCount > 0 &&
      row.every((c, index) => !c || index === cols.market || index === cols.weight) &&
      Math.abs(value - groupMarket) <= 0.01 * (groupCount + 1) + Number.EPSILON &&
      Math.abs(numericWeight / 100 - groupWeight) <= 0.0001 * (groupCount + 1) + Number.EPSILON
    ) {
      resetGroup();
      continue;
    }
    if (!name) throw new Error(`${sheetName}: missing holding name at row ${i + 1}`);
    const derived = value === undefined ? undefined : value / totalNAV;
    const smallWeight = tinyMarks.has(weightText);
    if (numericWeight === undefined && !smallWeight)
      throw new Error(`${sheetName}: invalid weight for ${name}`);
    let weight = smallWeight ? (derived ?? 0) : numericWeight! / 100;
    if (smallWeight)
      warnings.push(`${name}: disclosed as less than 0.01%; used market value / total net assets`);
    // Percent signs are authoritative. For a bare cell, distinguish percentage
    // points from an accidentally unformatted fraction using the same NAV column.
    // This avoids treating small valid HDFC percentages as raw fractions.
    if (
      numericWeight !== undefined &&
      !weightText.includes('%') &&
      derived !== undefined &&
      Math.abs(numericWeight - derived) < Math.abs(weight - derived)
    ) {
      weight = derived;
      warnings.push(`${name}: ambiguous percentage format; used market value / total net assets`);
    }
    if (!Number.isFinite(weight) || Math.abs(weight) > 1 + ROUNDING_TOLERANCE)
      throw new Error(`${sheetName}: invalid weight for ${name}`);
    if (derived !== undefined && Math.abs(weight - derived) > ROUNDING_TOLERANCE)
      throw new Error(`${sheetName}: weight disagrees with net assets for ${name}`);
    const classification = classify(name, isin, section);
    const industry = row[cols.industry];
    // Short legs and futures listed among the holdings (DSP, SBI, Tata) are derivatives too.
    if (
      (weight < 0 && classification.kind !== 'cash') ||
      /\b(?:futures|options)\b/i.test(industry ?? '')
    ) {
      derivativeWeight += weight;
      continue;
    }
    const key = [name, isin, value, weightText].join('|');
    if (key === previous) repeated.add(constituents.length);
    previous = key;
    constituents.push({
      name,
      ...(isin ? { isin } : {}),
      weight,
      ...classification,
      ...(industry ? { industry } : {}),
    });
    groupMarket += value ?? 0;
    groupWeight += weight;
    groupCount++;
  }
  // Quant can repeat a row, and lists futures at contract value inside the table with their
  // offset in net current assets. Each fix applies only when it makes the holdings add up.
  const sum = (list: FundConstituent[]) => list.reduce((n, c) => n + c.weight, 0);
  const unique = constituents.filter((_, i) => !repeated.has(i));
  const offset: FundConstituent = {
    name: 'Futures offset in net current assets',
    weight: derivativeWeight,
    kind: 'cash',
    assetClass: 'cash',
  };
  const fixes: { list: FundConstituent[]; notes: string[] }[] = [{ list: constituents, notes: [] }];
  if (repeated.size)
    fixes.push({
      list: unique,
      notes: [
        `Left out ${repeated.size === 1 ? 'a row' : `${repeated.size} rows`} repeated in the report`,
      ],
    });
  const futures = `Futures of ${(derivativeWeight * 100).toFixed(2)}% of net assets are in the table; their offset counts as cash`;
  if (derivativeWeight)
    fixes.push(...fixes.map((f) => ({ list: [...f.list, offset], notes: [...f.notes, futures] })));
  const fixed = fixes.find((f) => Math.abs(sum(f.list) - 1) <= ROUNDING_TOLERANCE + Number.EPSILON);
  if (!constituents.length || !fixed)
    throw new Error(`${sheetName}: incomplete portfolio weight (${sum(constituents)})`);
  warnings.push(...fixed.notes);
  const reportedWeight = sum(fixed.list);
  if (Math.abs(reportedWeight - 1) > 0.000001)
    warnings.push(
      `Published holdings sum to ${(reportedWeight * 100).toFixed(4)}% of net assets; weights retain disclosure rounding`,
    );
  return {
    id: `${file.source}:${normaliseFundName(schemeName)}`,
    schemeName,
    source: file.source,
    sourceUrl: file.url,
    asOf,
    constituents: fixed.list,
    reportedWeight,
    derivatives,
    warnings,
  };
}

/**
 * Parse legacy XLS or OOXML based on bytes, whatever the extension says, or each workbook
 * in a zip (DSP). With `skipped`, a scheme sheet that can't be read goes there instead of failing
 * the whole file.
 */
export async function parseFundWorkbook(
  bytes: Uint8Array,
  file: FundReportFile,
  skipped?: (error: Error) => void,
): Promise<FundPortfolio[]> {
  if (!bytes.length || bytes.length > MAX_FUND_FILE_BYTES)
    throw new Error('Fund workbook is empty or exceeds size limit');
  if (!/\.zip$/i.test(file.name)) return parseBook(bytes, file, skipped);
  const books = (await unzip(new Uint8Array(bytes), MAX_FUND_FILE_BYTES)).filter((entry) =>
    /\.xlsx?$/i.test(entry.name),
  );
  if (!books.length) throw new Error('Fund zip contains no workbooks');
  const portfolios: FundPortfolio[] = [];
  for (const book of books) portfolios.push(...(await parseBook(book.bytes, file, skipped)));
  return portfolios;
}

async function parseBook(
  bytes: Uint8Array,
  file: FundReportFile,
  skipped?: (error: Error) => void,
): Promise<FundPortfolio[]> {
  const XLSX = await import('xlsx');
  const metadata = XLSX.read(bytes, { type: 'array', bookSheets: true });
  if (!metadata.SheetNames.length || metadata.SheetNames.length > MAX_SHEETS)
    throw new Error('Fund workbook worksheet count exceeds limit');
  // HDFC derivative disclosures can advertise 65k empty rows or 256 columns.
  // They contain exposure tables rather than physical assets: do not parse them.
  const derivativeSheets = metadata.SheetNames.filter((name) => /^derivatives?/i.test(name));
  const physicalSheets = metadata.SheetNames.filter((name) => !derivativeSheets.includes(name));
  if (!physicalSheets.length) throw new Error('Fund workbook contains no portfolio tables');
  const workbook = XLSX.read(bytes, {
    type: 'array',
    sheets: physicalSheets,
    sheetRows: MAX_ROWS + 1,
    cellFormula: false,
    cellHTML: false,
  });
  const portfolios: FundPortfolio[] = [];
  const sheetNames: string[] = [];
  let firstError: Error | undefined;
  for (const name of workbook.SheetNames) {
    if (derivativeSheets.includes(name)) continue;
    const sheet: WorkSheet | undefined = workbook.Sheets[name];
    if (!sheet?.['!ref']) continue;
    try {
      if (XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref']).e.r >= MAX_ROWS)
        throw new Error(`${name}: worksheet range exceeds limit`);
      // SBI, Mirae Asset and Tata declare up to 256 empty columns; tables sit in the first few.
      const range = XLSX.utils.decode_range(sheet['!ref']);
      range.e.c = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);
      const rows = XLSX.utils
        .sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: false,
          defval: '',
          blankrows: true,
          range,
        })
        .map((row) => row.map(clean));
      const portfolio = parseSheet(rows, name, file);
      if (portfolio) {
        portfolios.push(portfolio);
        sheetNames.push(name);
      }
    } catch (error) {
      if (!skipped) throw error;
      firstError ??= error as Error;
      skipped(error as Error);
    }
  }
  if (!portfolios.length)
    throw firstError ?? new Error('Fund workbook contains no portfolio tables');
  for (const [index, portfolio] of portfolios.entries()) {
    const scheme = normaliseFundName(portfolio.schemeName).replace(/ /g, '');
    const sheet = normaliseFundName(sheetNames[index]!).replace(/ /g, '');
    if (
      derivativeSheets.some((name) => {
        const target = normaliseFundName(name.replace(/^derivatives?/i, '')).replace(/ /g, '');
        return (
          portfolios.length === 1 ||
          target === sheet ||
          (target.length > 0 && scheme.startsWith(target))
        );
      })
    )
      portfolio.derivatives = true;
  }
  return portfolios;
}
