// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  fetchNseReference,
  NSE_LISTS,
  parseNseConstituents,
  validateNseReference,
} from './reference.ts';

const csv =
  '\uFEFFCompany Name,Industry,Symbol,Series,ISIN Code\r\n"One, Ltd",Financial Services,ONE,EQ,INE001\r\n';

describe('NSE classification lists', () => {
  it('reads official headings, BOM and quoted company names', () => {
    expect(parseNseConstituents(csv, 'large')).toEqual([
      { symbol: 'ONE', isin: 'INE001', industry: 'Financial Services', marketCap: 'large' },
    ]);
    expect(() => parseNseConstituents('<html>blocked</html>', 'large')).toThrow();
  });
  it('downloads whole lists and preserves failed buckets from a saved list', async () => {
    const requests: string[] = [];
    const old = {
      date: '2026-10-20',
      rows: [{ symbol: 'OLD', isin: 'INE002', industry: 'IT', marketCap: 'mid' as const }],
    };
    const data = await fetchNseReference(
      async (url) => {
        requests.push(url);

        if (url === NSE_LISTS.large) {
          return csv;
        }

        throw new Error('offline');
      },
      '2026-10-22',
      old,
    );

    expect(requests).toHaveLength(4);
    expect(data.rows.map((r) => r.symbol)).toEqual(['ONE', 'OLD']);
    expect(data.date).toBe('2026-10-20');
    expect(data.stale).toEqual(['mid', 'small', 'micro']);
  });
  it('rejects list data with missing or odd fields', () => {
    const row = { symbol: 'ONE', isin: 'INE001', industry: 'IT', marketCap: 'large' };
    const valid = { date: '2026-10-22', rows: [row], stale: ['mid'] };

    expect(validateNseReference(valid)).toEqual(valid);

    for (const invalid of [
      null,
      { ...valid, date: '22/10/2026' },
      { ...valid, rows: {} },
      { ...valid, stale: ['huge'] },
      { ...valid, rows: [{ ...row, isin: undefined }] },
      { ...valid, rows: [{ ...row, symbol: '' }] },
      { ...valid, rows: [{ ...row, industry: 3 }] },
      { ...valid, rows: [{ ...row, marketCap: 'huge' }] },
      { ...valid, rows: [null] },
    ]) {
      expect(() => validateNseReference(invalid)).toThrow();
    }
  });
});
