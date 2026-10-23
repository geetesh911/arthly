// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { amfiDate, parseAmfi, parseBhavcopy } from './parse.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('AMFI', () => {
  it('parses schemes with plan, option and category', () => {
    const { date, rows } = parseAmfi(fixture('NAVAll.txt'));
    expect(date).toBe('2026-10-21');
    expect(rows.find((r) => r[0] === '147481')).toEqual([
      '147481',
      'INF879O01100',
      '',
      'Parag Parikh ELSS Tax Saver Fund Direct Plan Growth',
      'Equity Scheme - ELSS',
      30.8127,
      '2026-10-21',
    ]);
    expect(rows.find((r) => r[0] === '120504')?.[2]).toBe('INF846K01EG5');
  });

  it('reads its dates', () => {
    expect(amfiDate('21-Oct-2026')).toBe('2026-10-21');
    expect(amfiDate('1-Jan-2027')).toBe('2027-01-01');
    expect(amfiDate('2026-10-21')).toBeUndefined();
  });

  it('fails loudly when the headings change', () => {
    expect(() => parseAmfi('Code;Name\n1;x')).toThrow('headings have changed');
  });
});

describe('bhavcopy', () => {
  it('parses NSE stocks, ETFs and SGBs', () => {
    const { date, rows } = parseBhavcopy(fixture('nse-bhavcopy.csv'));
    expect(date).toBe('2026-10-21');
    expect(rows).toContainEqual(['SGBFEB32IV', 'GB', 'IN0020230184', 15155.6]);
    expect(rows).toContainEqual(['NIFTYBEES', 'EQ', 'INF204KB14I2', 259.57]);
  });

  it('parses BSE in the same format', () => {
    const { rows } = parseBhavcopy(fixture('bse-bhavcopy.csv'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r[2].startsWith('IN'))).toBe(true);
  });
});
