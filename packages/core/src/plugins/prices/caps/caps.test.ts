// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  AMFI_CAPS_PAGE,
  fetchAmfiCaps,
  findAmfiCapsUrl,
  isAmfiCapsUrl,
  parseAmfiCaps,
  validateAmfiCaps,
} from './caps.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const PAGE = fixture('categorisation-of-stocks.html').toString('utf8');
const LIST = new Uint8Array(fixture('AverageMarketCapitalization30Jun2026.xlsx'));
const URL_2026 = 'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx';
const HEAD = [
  'Sr. No.',
  'Company name',
  'ISIN',
  'BSE Symbol',
  'BSE 6 month Avg Total Market Cap in (Rs. Crs.)',
  'NSE Symbol',
  'NSE 6 month Avg Total Market Cap (Rs. Crs.)',
  'MSEI Symbol',
  'MSEI 6 month Avg Total Market Cap in (Rs Crs.)',
  'Average of All Exchanges (Rs. Cr.)',
  'Categorization as per SEBI Circular dated Oct 6, 2017',
];

/** A workbook laid out like AMFI's, with the given rows under its headings. */
async function workbook(rows: unknown[][], title = 'during the six months ended 30 June 2026') {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  const lines = [[`Average Market Capitalization of listed companies ${title}`], HEAD, ...rows];

  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(lines), 'FINAL');

  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const row = (isin: string, nse: string, category: string) => [
  1,
  'A Company Ltd',
  isin,
  nse,
  100,
  nse,
  100,
  '-',
  '',
  100,
  category,
];

describe('finding AMFI’s list', () => {
  it('picks the newest workbook published by the day', () => {
    expect(findAmfiCapsUrl(PAGE, '2026-10-23')).toBe(URL_2026);
    expect(findAmfiCapsUrl(PAGE, '2026-06-29')).toBe(
      'https://www.amfiindia.com/Themes/Theme1/downloads/AverageMarketCapitalization31Dec2025.xlsx',
    );
  });

  it('only accepts AMFI’s own list workbooks', () => {
    expect(isAmfiCapsUrl(URL_2026)).toBe(true);
    expect(
      isAmfiCapsUrl(
        'https://www.amfiindia.com/Themes/Theme1/downloads/AverageMarketCapitalizationoflistedcompaniesduringthesixmonthsended30June2022.xlsx',
      ),
    ).toBe(true);

    for (const url of [
      'http://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx',
      'https://amfiindia.example.com/spages/AverageMarketCapitalization30Jun2026.xlsx',
      `${URL_2026}?x=1`,
      'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.pdf',
      'https://portal.amfiindia.com/spages/NAVAll.xlsx',
      'https://www.amfiindia.com/Themes/Theme1/downloads/Avg.%20Market%20Capitalization%20of%20listed%20companies%20during%20Jul-Dec%202019.xlsx',
    ]) {
      expect(isAmfiCapsUrl(url)).toBe(false);
    }

    expect(() =>
      findAmfiCapsUrl(
        '<a href="https://example.com/AverageMarketCapitalization30Jun2026.xlsx">Excel</a>',
        '2026-10-23',
      ),
    ).toThrow('AMFI’s page has no cap list');
  });

  it('downloads the page, then the workbook, without leaving AMFI', async () => {
    const asked: string[] = [];
    const fetcher = (async (input: string | URL) => {
      const url = String(input);

      asked.push(url);

      if (url === AMFI_CAPS_PAGE) {
        return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
      }

      if (url === URL_2026) {
        return new Response(LIST);
      }

      return new Response('', {
        status: 302,
        headers: { location: 'https://evil.example/x.xlsx' },
      });
    }) as typeof fetch;
    const { url, response } = await fetchAmfiCaps(fetcher, '2026-10-23');

    expect(url).toBe(URL_2026);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(LIST);
    expect(asked).toEqual([AMFI_CAPS_PAGE, URL_2026]);

    const moved = (async (input: string | URL) =>
      String(input) === AMFI_CAPS_PAGE
        ? new Response(PAGE)
        : new Response('', {
            status: 302,
            headers: { location: 'https://evil.example/AverageMarketCapitalization30Jun2026.xlsx' },
          })) as typeof fetch;

    await expect(fetchAmfiCaps(moved, '2026-10-23')).rejects.toThrow('Unapproved cap list URL');
  });
});

describe('reading AMFI’s list', () => {
  it('reads the official workbook, keeping symbols only where they exist', async () => {
    const file = await parseAmfiCaps(LIST, URL_2026, '2026-10-23');

    expect(file).toMatchObject({
      version: 1,
      date: '2026-10-23',
      asOf: '2026-06-30',
      url: URL_2026,
    });
    expect(file.rows).toEqual([
      { isin: 'INE002A01018', nse: 'RELIANCE', cap: 'large' },
      { isin: 'INE040A01034', nse: 'HDFCBANK', cap: 'large' },
      { isin: 'INE118H01025', nse: 'BSE', cap: 'large' },
      { isin: 'INE129A01019', nse: 'GAIL', cap: 'large' },
      { isin: 'INE323A01026', nse: 'BOSCHLTD', cap: 'mid' },
      { isin: 'INE745G01043', cap: 'mid' },
      { isin: 'INE233A01035', nse: 'GODREJIND', cap: 'mid' },
      { isin: 'INE048G01026', nse: 'NAVINFLUOR', cap: 'small' },
      { isin: 'INE523W01017', cap: 'small' },
    ]);
    // This excerpt isn't the whole list, so its counts are flagged.
    expect(file.warnings).toEqual(['The list has 4 large and 3 mid caps, not 100 and 150']);
    expect(validateAmfiCaps(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it('skips malformed rows and drops companies listed with two sizes', async () => {
    const file = await parseAmfiCaps(
      await workbook([
        row('INE002A01018', 'RELIANCE', 'Large Cap'),
        row('INE040A01034', 'HDFCBANK', 'Large Cap'),
        row('INE040A01034', 'HDFCBANK', 'Mid Cap'),
        row('US0378331005', 'AAPL', 'Large Cap'),
        row('INE323A01026', 'BOSCHLTD', 'Giant'),
        ['', '', '', '', '', '', '', '', '', '', ''],
      ]),
      URL_2026,
      '2026-10-23',
    );

    expect(file.rows).toEqual([{ isin: 'INE002A01018', nse: 'RELIANCE', cap: 'large' }]);
    expect(file.warnings).toEqual([
      'The list has 1 large and 0 mid caps, not 100 and 150',
      '2 rows have no valid ISIN or category',
      '1 ISINs are listed twice with different sizes',
    ]);
  });

  it('takes the period from the file name when the title lacks one', async () => {
    const file = await parseAmfiCaps(
      await workbook([row('INE002A01018', 'RELIANCE', 'Large Cap')], ''),
      URL_2026,
      '2026-10-23',
    );

    expect(file.asOf).toBe('2026-06-30');
  });

  it('refuses error pages, changed headings, future periods and empty lists', async () => {
    const html = new TextEncoder().encode('<html>Access Denied</html>');

    await expect(parseAmfiCaps(html, URL_2026, '2026-10-23')).rejects.toThrow('isn’t a workbook');
    const XLSX = await import('xlsx');
    const book = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Company', 'Code', 'Size']]), 'S');
    const renamed = new Uint8Array(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );

    await expect(parseAmfiCaps(renamed, URL_2026, '2026-10-23')).rejects.toThrow(
      'headings have changed',
    );
    await expect(parseAmfiCaps(LIST, URL_2026, '2026-06-01')).rejects.toThrow('has no period');
    await expect(parseAmfiCaps(await workbook([]), URL_2026, '2026-10-23')).rejects.toThrow(
      'has no companies',
    );
    await expect(
      parseAmfiCaps(
        LIST,
        'https://example.com/AverageMarketCapitalization30Jun2026.xlsx',
        '2026-10-23',
      ),
    ).rejects.toThrow('Unapproved cap list URL');
  });

  it('checks saved and published lists', async () => {
    const file = await parseAmfiCaps(LIST, URL_2026, '2026-10-23');
    const bad = [
      { ...file, version: 2 },
      { ...file, asOf: '2026-10-24' },
      { ...file, url: 'https://example.com/AverageMarketCapitalization30Jun2026.xlsx' },
      { ...file, rows: [] },
      { ...file, rows: [{ isin: 'INE002A01018', cap: 'micro' }] },
      { ...file, rows: [{ isin: 'IN-BAD', cap: 'large' }] },
      { ...file, rows: [{ isin: 'INE002A01018', nse: '', cap: 'large' }] },
      { ...file, warnings: [42] },
      null,
    ];

    for (const value of bad) {
      expect(() => validateAmfiCaps(value)).toThrow('Unexpected cap list data');
    }
  });
});
