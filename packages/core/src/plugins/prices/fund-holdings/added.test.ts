// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { addFundReports, readFundReport, withAddedReports } from './added.ts';
import type { FundPortfolio } from './types.ts';

const workbook = (title: string, date = 'September 30, 2026') => {
  const book = XLSX.utils.book_new();
  const rows = [
    [`PORTFOLIO STATEMENT OF ${title} AS ON ${date}`],
    ['(An open ended equity scheme predominantly investing in mid cap stocks)'],
    ['Name of the Instrument', 'ISIN', 'Rating/Industry', 'Quantity', 'Market Value', '% to NAV'],
    ['Equity & Equity related'],
    ['Example Limited', 'INE123456789', 'Banks', 1, 99, '99%'],
    ['Net Current Assets', '', '', '', 1, '1%'],
    ['GRAND TOTAL', '', '', '', 100, '100%'],
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'EESMCF');
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
};
const report = (id: string, schemeName: string, asOf: string): FundPortfolio => ({
  id,
  schemeName,
  source: id.startsWith('file:') ? 'file' : 'ppfas',
  sourceUrl: '',
  asOf,
  constituents: [],
  reportedWeight: 1,
  derivatives: false,
  warnings: [],
});

describe('fund reports added by hand', () => {
  it('reads a downloaded workbook as an added report with no source address', async () => {
    const { portfolios, skipped } = await readFundReport(
      'EDEL_Portfolio_Monthly.xlsx',
      workbook('EXAMPLE MID CAP FUND'),
      '2026-10-23',
    );
    expect(skipped).toEqual([]);
    expect(portfolios).toMatchObject([
      {
        id: 'file:example mid cap fund',
        source: 'file',
        sourceUrl: '',
        asOf: '2026-09-30',
      },
    ]);
  });

  it('turns down files that aren’t portfolios, and reports dated after today', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Scheme', 'Units']]), 'Sheet1');
    const other = new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    await expect(readFundReport('holdings.xlsx', other, '2026-10-23')).rejects.toThrow(
      'holdings.xlsx isn’t a monthly portfolio report the app can read',
    );
    await expect(
      readFundReport(
        'next.xlsx',
        workbook('EXAMPLE MID CAP FUND', 'November 30, 2026'),
        '2026-10-23',
      ),
    ).rejects.toThrow(/dated after today/);
  });

  it('keeps the newest added report of each scheme', () => {
    const saved = [
      report('file:a', 'A Fund', '2026-09-30'),
      report('file:b', 'B Fund', '2026-09-30'),
    ];
    const next = [
      report('file:a', 'A Fund', '2026-10-31'),
      report('file:a', 'A Fund', '2026-08-31'),
    ];
    expect(addFundReports(saved, next).map((p) => [p.id, p.asOf])).toEqual([
      ['file:a', '2026-10-31'],
      ['file:b', '2026-09-30'],
    ]);
  });

  it('uses an added report only where it is newer than any fetched report of the scheme', () => {
    const fetched = [
      report('ppfas:a fund', 'A Fund', '2026-08-31'),
      report('ppfas:b fund', 'B FUND', '2026-09-30'),
    ];
    const added = [
      report('file:a fund', 'A FUND', '2026-09-30'),
      report('file:b fund', 'B Fund', '2026-09-30'),
      report('file:c fund', 'C Fund', '2026-09-30'),
    ];
    expect(withAddedReports(fetched, added).map((p) => p.id)).toEqual([
      'ppfas:b fund',
      'file:a fund',
      'file:c fund',
    ]);
    expect(withAddedReports(fetched, [])).toEqual(fetched);
  });
});
