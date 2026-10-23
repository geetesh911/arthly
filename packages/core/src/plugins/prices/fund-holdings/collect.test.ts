// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectFundHoldings, mergeFundHoldings, validateFundHoldings } from './collect.ts';
import { parseFundWorkbook } from './parse.ts';
import type { FundDisclosureFile, FundDisclosureIndex } from './types.ts';

const file: FundDisclosureFile = {
  source: 'ppfas',
  url: 'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls',
  name: 'ppfas.xls',
};
const bytes = new Uint8Array(readFileSync(new URL('./fixtures/ppfas.xls', import.meta.url)));
const index: FundDisclosureIndex = { version: 1, date: '2026-10-23', files: [file], failures: [] };
describe('fund portfolio collection', () => {
  it('rejects malformed feed identifiers and metadata before they enter the cache', async () => {
    const portfolios = await parseFundWorkbook(bytes, file);
    const valid = { version: 1 as const, date: index.date, portfolios, failures: [] };
    expect(validateFundHoldings(valid)).toEqual(valid);
    for (const invalid of [
      { schemeIsins: [123] },
      { amfiCodes: {} },
      { warnings: [123] },
      { derivatives: 'yes' },
      { reportedWeight: null },
      { source: 'unknown' },
      { constituents: [{ ...portfolios[0]!.constituents[0]!, industry: {} }] },
    ]) {
      expect(() =>
        validateFundHoldings({ ...valid, portfolios: [{ ...portfolios[0], ...invalid }] }),
      ).toThrow();
    }
    expect(() => validateFundHoldings({ ...valid, failures: [null] })).toThrow();
    expect(() => validateFundHoldings({ ...valid, retained: [1] })).toThrow();
    expect(validateFundHoldings({ ...valid, retained: ['a'] }).retained).toEqual(['a']);
  });
  it('lists the reports a refresh kept from before', async () => {
    const portfolios = await parseFundWorkbook(bytes, file);
    const ids = portfolios.map((p) => p.id);
    const old = { version: 1 as const, date: '2026-10-22', portfolios, failures: [] };
    expect(mergeFundHoldings(undefined, old).retained).toEqual(ids);
    const kept = { ...portfolios[0]!, id: 'hdfc:kept' };
    const merged = mergeFundHoldings(
      { version: 1, date: '2026-10-23', portfolios, failures: [], retained: [ids[1]!, 'gone'] },
      { ...old, portfolios: [...portfolios, kept] },
    );
    expect(merged.retained?.sort()).toEqual([ids[1]!, 'hdfc:kept'].sort());
  });
  it('parses a whole official workbook and reuses an unchanged cached workbook', async () => {
    const fresh = await collectFundHoldings(index, async () => bytes);
    expect(fresh.portfolios).toHaveLength(7);
    let fetched = 0;
    const again = await collectFundHoldings(
      index,
      async () => {
        fetched++;
        throw new Error('should not download');
      },
      fresh,
    );
    expect(again.portfolios).toHaveLength(7);
    expect(fetched).toBe(0);
  });
  it('preserves last successful portfolios if a forced download or source listing fails', async () => {
    const portfolios = await parseFundWorkbook(bytes, file);
    const old = { version: 1 as const, date: '2026-10-22', portfolios, failures: [] };
    const next = await collectFundHoldings(
      { ...index, failures: [{ source: 'hdfc', message: 'offline' }] },
      async () => {
        throw new Error('offline');
      },
      old,
      true,
    );
    expect(next.portfolios).toHaveLength(7);
    expect(next.portfolios[0]?.asOf).toBe('2026-09-30');
    expect(next.failures).toHaveLength(2);
    expect(next.retained).toHaveLength(7);
    expect(mergeFundHoldings(undefined, old).portfolios).toHaveLength(7);
  });
});

describe('consolidated workbooks', () => {
  it('keeps the schemes it can read and reports the rest', async () => {
    const XLSX = await import('xlsx');
    const book = XLSX.utils.book_new();
    const sheet = (weight: number) =>
      XLSX.utils.aoa_to_sheet([
        ['Example Fund'],
        ['Monthly Portfolio Statement as on September 30, 2026'],
        ['Name of the Instrument', 'ISIN', 'Industry', 'Market Value', '% to NAV'],
        ['Equity & Equity related'],
        ['Example Limited', 'INE123456789', 'Banks', weight, `${weight}%`],
        ['GRAND TOTAL', '', '', 100, '100%'],
      ]);
    XLSX.utils.book_append_sheet(book, sheet(100), 'GOOD');
    XLSX.utils.book_append_sheet(book, sheet(40), 'BAD');
    const workbook = new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    const result = await collectFundHoldings(index, async () => workbook);
    expect(result.portfolios).toHaveLength(1);
    expect(result.failures).toEqual([
      {
        source: 'ppfas',
        message: expect.stringMatching(
          /^ppfas\.xls: one scheme couldn’t be read \(BAD: incomplete/,
        ),
      },
    ]);
  });
});
