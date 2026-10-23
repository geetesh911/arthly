// SPDX-License-Identifier: AGPL-3.0-only
// Official source adapters: requests never contain an investor's portfolio or scheme list.
import { endOfMonth, isISODate, makeDate } from '../../../util/dates.ts';
import { fetchAllowed } from '../../../util/http.ts';
import type { FundDisclosureFile, FundDisclosureIndex, FundSourceId } from './types.ts';

/** A request that lists files: a page, or a JSON body posted the way the AMC's own page does. */
export interface FundListing {
  url: string;
  json?: unknown;
}

export interface FundSource {
  label: string;
  /** The page that lists the monthly portfolios; relative links resolve against it. */
  listing: string;
  /** What to fetch instead, when the page loads its links with scripts. */
  requests?: (today: string) => FundListing[];
  /** Each file's month end, when its name doesn't say. */
  dates?: (text: string, request: FundListing) => Map<string, string>;
  /** A workbook must be on one of `origins` under `path`, with a name matching `file`. */
  origins: string[];
  path: string;
  file: RegExp;
  /** The query string the AMC's own links use. */
  query: RegExp;
}

const SFVRSN = /^(?:\?sfvrsn=[0-9a-f]{1,16}_\d{1,4})?$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The month ends of the `count` months before `today`'s, newest first. */
function monthsBefore(today: string, count: number): { year: number; month: number }[] {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, n) => {
    const index = year * 12 + month - 2 - n;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  });
}

const INVESCO_CLASSES = [
  'equity',
  'fixed-income',
  'fund-of-funds',
  'exchange-traded-fund',
  'hybrid',
  'index-funds',
];

/** Where each AMC lists its monthly portfolios. */
export const FUND_SOURCES: Record<FundSourceId, FundSource> = {
  ppfas: {
    label: 'PPFAS',
    listing: 'https://amc.ppfas.com/downloads/portfolio-disclosure/index.php',
    origins: ['https://amc.ppfas.com'],
    path: '/downloads/portfolio-disclosure/',
    file: /^PPFAS_Monthly_Portfolio_Report_/i,
    // A date that defeats caches, such as ?07102026.
    query: /^(?:\?\d{1,12})?$/,
  },
  nippon: {
    label: 'Nippon India',
    listing:
      'https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures/',
    origins: ['https://mf.nipponindiaim.com'],
    path: '/investorservices/factsheetsdocuments/',
    file: /^NIMF[-_]MONTHLY[-_]PORTFOLIO/i,
    query: /^$/,
  },
  hdfc: {
    label: 'HDFC',
    listing: 'https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio',
    origins: ['https://files.hdfcfund.com'],
    path: '/s3fs-public/',
    file: /^monthly\s/i,
    query: /^(?:\?VersionId=[\w.-]{1,200})?$/,
  },
  sbi: {
    label: 'SBI',
    listing: 'https://www.sbimf.com/portfolios',
    // With no year or month, it lists every consolidated monthly workbook.
    requests: () => [
      {
        url: 'https://www.sbimf.com/ajaxcall/CMS/GetSchemePortfolioSheets',
        json: { FundId: 0, PSYear: '', PSMonth: '', PSFrequency: 'Monthly' },
      },
    ],
    origins: ['https://www.sbimf.com'],
    path: '/docs/default-source/scheme-portfolios/',
    file: /^all-schemes?-monthly-portfolio/i,
    query: SFVRSN,
  },
  tata: {
    label: 'Tata',
    listing: 'https://www.tatamutualfund.com/schemes-related/portfolio',
    // Its CMS host redirects to the main one.
    origins: ['https://betacms.tatamutualfund.com', 'https://www.tatamutualfund.com'],
    path: '/system/files/',
    file: /^Monthly Portfolio as /i,
    query: /^$/,
  },
  dsp: {
    label: 'DSP',
    listing: 'https://www.dspim.com/mandatory-disclosures/portfolio-disclosures',
    origins: ['https://www.dspim.com'],
    path: '/media/pages/mandatory-disclosures/portfolio-disclosures/',
    // A zip of an equity and a debt workbook.
    file: /^(?:dsp-)?month[-_]?end[-_]portfolio/i,
    query: /^$/,
  },
  boi: {
    label: 'Bank of India',
    listing: 'https://www.boimf.in/investor-corner',
    requests: () => [
      {
        url: 'https://www.boimf.in/AjaxService.asmx/GetDocuments',
        json: {
          pagno: 0,
          category: null,
          fromDate: null,
          toDate: null,
          LibraryName: 'InvestorCorner',
          folderName: 'MONTHLY PORTFOLIO',
          CategoryValue: 'no',
        },
      },
    ],
    origins: ['https://www.boimf.in'],
    path: '/docs/default-source/investorcorner/monthly-portfolio/',
    file: /^monthly-portfolio/i,
    query: SFVRSN,
  },
  zerodha: {
    label: 'Zerodha',
    listing: 'https://www.zerodhafundhouse.com/resources/disclosures',
    origins: ['https://assets.zerodhafundhouse.com'],
    path: '/statutory-reports/portfolio-disclosures/',
    file: /monthly.*portfolio/i,
    query: /^$/,
  },
  quant: {
    label: 'Quant',
    listing: 'https://quantmutual.com/statutory-disclosures',
    // One file per scheme, listed a month at a time.
    requests: (today) =>
      monthsBefore(today, 2).map(({ year, month }) => ({
        url: 'https://quantmutual.com/statutorydisclosures.aspx/displaydisclouser2',
        json: { id: String(month), cat: 'MONTHLY PORTFOLIO - FUND - WISE', tab: String(year) },
      })),
    origins: ['https://quantmutual.com'],
    path: '/admin/disclouser/',
    file: /^quant_/i,
    query: /^$/,
  },
  invesco: {
    label: 'Invesco',
    listing: 'https://www.invescomutualfund.com/literature-forms/monthly-holdings/equity',
    // One file per scheme, listed by fund type and year; file names often lack the month.
    requests: (today) =>
      [...new Set(monthsBefore(today, 2).map((m) => m.year))].flatMap((year) =>
        INVESCO_CLASSES.map((type) => ({
          url: `https://www.invescomutualfund.com/api/CompleteMonthlyHoldings?year=${year}&classification=${type}`,
        })),
      ),
    dates: (text, request) => {
      const year = Number(new URL(request.url).searchParams.get('year'));
      const dates = new Map<string, string>();
      const schemes = JSON.parse(text) as Record<string, unknown>[];
      for (const scheme of Array.isArray(schemes) ? schemes : [])
        MONTHS.forEach((month, index) => {
          const url = scheme[`${month[0]!.toUpperCase()}${month.slice(1)}Url`];
          if (typeof url === 'string' && url)
            dates.set(new URL(url).href, endOfMonth(makeDate(year, index + 1, 1)));
        });
      return dates;
    },
    origins: ['https://www.invescomutualfund.com'],
    path: '/docs/default-source/completes-monthly-holding/',
    file: /^[a-z0-9]/i,
    query: SFVRSN,
  },
  canara: {
    label: 'Canara Robeco',
    listing:
      'https://www.canararobeco.com/documents/statutory-disclosures/scheme-dashboard/scheme-monthly-portfolio/',
    // One file per scheme, ten to a page, listed a month at a time.
    requests: (today) =>
      monthsBefore(today, 2).flatMap(({ year, month }) =>
        [1, 2, 3, 4].map((page) => ({
          url: `https://www.canararobeco.com/documents/statutory-disclosures/scheme-dashboard/scheme-monthly-portfolio/?filteryear=${year}&filtermonth=${String(month).padStart(2, '0')}&pagination=${page}`,
        })),
      ),
    origins: ['https://www.canararobeco.com'],
    path: '/wp-content/uploads/',
    // A two-letter scheme code, such as "LC-–-Canara-Robeco-Large-Cap-Fund-–-September-2026".
    file: /^[A-Z]{2}\s*[-–]/,
    query: /^$/,
  },
  mirae: {
    label: 'Mirae Asset',
    listing: 'https://www.miraeassetmf.co.in/downloads/portfolio',
    // One file per scheme, newest first.
    requests: () => [
      {
        url: 'https://www.miraeassetmf.co.in/AjaxService/GetDownloadsData',
        json: { request: { modulename: 'portfolio_tab1', pgno: 1, pgsize: 120 } },
      },
    ],
    origins: ['https://www.miraeassetmf.co.in'],
    path: '/docs/default-source/portfolios/',
    file: /^[a-z0-9]+[_-]/i,
    query: /^$/,
  },
};

/** The requests that list a source's files on `today`. */
export const fundListings = (source: FundSource, today: string): FundListing[] =>
  source.requests?.(today) ?? [{ url: source.listing }];

export const MAX_FUND_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LISTING_BYTES = 5 * 1024 * 1024;
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; Arthly public portfolio disclosures)' };

/** The AMC whose monthly portfolio workbook (or zip of them) this is, or undefined otherwise. */
export function fundWorkbookSource(value: string): FundSourceId | undefined {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.hash || !/\.(?:xlsx?|zip)$/i.test(u.pathname))
      return undefined;
    const name = decodeURIComponent(u.pathname.split('/').at(-1) ?? '');
    if (/overlap|fortnight/i.test(name)) return undefined;
    return (Object.keys(FUND_SOURCES) as FundSourceId[]).find((id) => {
      const s = FUND_SOURCES[id];
      return (
        s.origins.includes(u.origin) &&
        u.pathname.toLowerCase().startsWith(s.path) &&
        s.file.test(name) &&
        s.query.test(u.search)
      );
    });
  } catch {
    return undefined;
  }
}

export const isFundWorkbookUrl = (value: string) => fundWorkbookSource(value) !== undefined;

function portfolioDate(url: string): string | undefined {
  const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '').replace(
    /[_-]/g,
    ' ',
  );
  const month =
    '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  // Also run together, as in DSP's "31march2026" and Mirae Asset's "malcf_sept2026".
  const before = new RegExp(
    `(?:^|\\s)(\\d{1,2})(?:st|nd|rd|th)?\\s*${month}\\s*(\\d{2,4})(?:\\D|$)`,
    'i',
  ).exec(name);
  const after = new RegExp(
    `(?:^|[^a-z])${month}\\s*(?:(\\d{1,2})\\s+)?(\\d{4})(?:\\D|$)`,
    'i',
  ).exec(name);
  const mon = before?.[2] ?? after?.[1];
  const year = before?.[3] ?? after?.[3];
  if (!mon || !year) return undefined;
  const m = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
  const y = Number(year) + (year.length === 2 ? 2000 : 0);
  const day = before?.[1] ?? after?.[2];
  const date = makeDate(y, m, Number(day ?? 1));
  return isISODate(date) ? (day ? date : endOfMonth(date)) : undefined;
}

/** The newest month's files in a listing; `dates` gives months that file names don't. */
export function discoverFundFiles(
  html: string,
  source: FundSourceId,
  today: string,
  dates = new Map<string, string>(),
): FundDisclosureFile[] {
  // The same URL can occur as an anchor, JSON property, or doubly escaped RSC string.
  let clean = html;
  for (let n = 0; n < 3; n++)
    clean = clean
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u0027/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/&#(?:34|x22);/gi, '"');
  const candidates = [...clean.matchAll(/["']([^"'<>\\]*\.(?:xlsx?|zip)(?:\?[^"'<>\\]*)?)["']/gi)];
  const files = new Map<string, FundDisclosureFile & { date: string }>();
  for (const match of candidates) {
    try {
      const u = new URL(match[1]!.trim(), FUND_SOURCES[source].listing);
      if (fundWorkbookSource(u.href) !== source) continue;
      const name = decodeURIComponent(u.pathname.split('/').at(-1) ?? '');
      const date = dates.get(u.href) ?? portfolioDate(u.href);
      if (!date || date > today) continue;
      files.set(u.href, { source, url: u.href, name, date });
    } catch {
      /* A malformed public link does not make the rest unusable. */
    }
  }
  const newest = [...files.values()]
    .map((f) => f.date)
    .sort()
    .at(-1);
  const latest = [...files.values()].filter((f) => f.date === newest);
  if (!latest.length) throw new Error('No dated monthly portfolio workbooks found');
  if (latest.length > 200) throw new Error('Unexpected number of portfolio files');
  return latest.map(({ source, url, name }) => ({ source, url, name }));
}

const response = (
  fetcher: typeof fetch,
  url: string,
  allowed: (url: string) => boolean,
  limit: number,
  json?: unknown,
) =>
  fetchAllowed(fetcher, url, {
    allowed,
    limit,
    headers: HEADERS,
    noun: 'portfolio',
    ...(json === undefined ? {} : { json: JSON.stringify(json) }),
  });

export async function fetchFundDisclosureIndex(
  fetcher: typeof fetch,
  date: string,
): Promise<FundDisclosureIndex> {
  const ids = Object.keys(FUND_SOURCES) as FundSourceId[];
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const source = FUND_SOURCES[id];
      const requests = fundListings(source, date);
      const texts = await Promise.all(
        requests.map(async (request) => {
          const res = await response(
            fetcher,
            request.url,
            (u) => new URL(u).origin === new URL(request.url).origin,
            MAX_LISTING_BYTES,
            request.json,
          );
          const text = await res.text();
          return { text, dates: source.dates?.(text, request) ?? new Map<string, string>() };
        }),
      );
      return discoverFundFiles(
        texts.map((t) => t.text).join('\n'),
        id,
        date,
        new Map(texts.flatMap((t) => [...t.dates])),
      );
    }),
  );
  return {
    version: 1,
    date,
    files: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    failures: results.flatMap((r, i) =>
      r.status === 'rejected' ? [{ source: ids[i]!, message: (r.reason as Error).message }] : [],
    ),
  };
}

export function fetchFundWorkbook(fetcher: typeof fetch, url: string): Promise<Response> {
  return response(fetcher, url, isFundWorkbookUrl, MAX_FUND_FILE_BYTES);
}
