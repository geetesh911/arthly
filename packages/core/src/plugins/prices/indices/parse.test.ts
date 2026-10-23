// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBseIndices, parseNseIndices } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parseNseIndices', () => {
  const { rows, warnings } = parseNseIndices(fixture('ind_close_all_22102026.csv'));
  const byName = (name: string) => rows.find((r) => r.name === name);

  it('reads every row of the daily snapshot, with fractions for percentages', () => {
    expect(rows).toHaveLength(17);
    expect(warnings).toEqual([]);
    expect(byName('Nifty 50')).toEqual({
      id: 'nse:nifty-50',
      provider: 'nse',
      name: 'Nifty 50',
      basis: 'price',
      currency: 'INR',
      date: '2026-10-22',
      open: 22687.75,
      high: 22785,
      low: 22554.85,
      close: 22687.65,
      change: -123.7,
      changeRatio: -0.0054,
      volume: 391598666,
      turnover: 31230.58e7,
      pe: 19.13,
      pb: 2.79,
      dividendYield: 0.015,
    });
  });

  it('leaves dashes out instead of reading them as zero', () => {
    const mahindra = byName('Nifty India Corporate Group Index - Mahindra Group')!;
    expect(mahindra.close).toBe(34441.97);
    expect(mahindra).not.toHaveProperty('open');
    expect(byName('Nifty Waves')).not.toHaveProperty('pe');
    expect(byName('India VIX')).not.toHaveProperty('volume');
  });

  it('labels the return basis only where the source says what it is', () => {
    const basis = Object.fromEntries(rows.map((r) => [r.name, r.basis]));
    expect(basis).toMatchObject({
      'Nifty 50': 'price',
      'India VIX': 'volatility',
      'Nifty50 Dividend Points': 'unknown',
      'Nifty50 TR 2x Leverage': 'unknown',
      'Nifty50 PR 1x Inverse': 'unknown',
      'Nifty 50 Arbitrage': 'unknown',
      'Nifty 10 yr Benchmark G-Sec': 'total',
      'Nifty 10 yr Benchmark G-Sec (Clean Price)': 'price',
      'Nifty 1D Rate Index': 'total',
    });
    expect(byName('Nifty50 USD')?.currency).toBe('USD');
    expect(byName('Nifty 10 yr Benchmark G-Sec')?.id).not.toBe(
      byName('Nifty 10 yr Benchmark G-Sec (Clean Price)')?.id,
    );
  });

  it('keeps quoted commas and skips malformed or impossible rows', () => {
    const head =
      'Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield';
    const { rows, warnings } = parseNseIndices(
      [
        head,
        '"Nifty Bank, Private",22-10-2026,-,-,-,"1,234.5",1,.1,-,-,-,-,-',
        'Nifty Bad,22-10-2026,-,-,-,12x,1,.1,-,-,-,-,-',
        'Nifty Zero,22-10-2026,-,-,-,0,1,.1,-,-,-,-,-',
        'Nifty Late,31-02-2026,-,-,-,10,1,.1,-,-,-,-,-',
      ].join('\r\n'),
    );
    expect(rows.map((r) => [r.name, r.close])).toEqual([['Nifty Bank, Private', 1234.5]]);
    expect(warnings).toEqual([
      'NSE: Nifty Bad has a malformed number',
      'NSE: Nifty Zero has no closing level',
      'NSE: Nifty Late has an impossible date',
    ]);
  });

  it('drops a series listed twice with different levels', () => {
    const head =
      'Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield';
    const twice = (close: string) => `Nifty X,22-10-2026,-,-,-,${close},-,-,-,-,-,-,-`;
    expect(parseNseIndices([head, twice('10'), twice('10')].join('\n')).rows).toHaveLength(1);
    const conflict = parseNseIndices([head, twice('10'), twice('11'), twice('10')].join('\n'));
    expect(conflict.rows).toEqual([]);
    expect(conflict.warnings).toEqual(['NSE: Nifty X is listed twice with different levels']);
  });

  it('rejects an error page or a changed layout', () => {
    expect(() => parseNseIndices('<html><body>Access Denied</body></html>')).toThrow(
      'NSE index file headings have changed',
    );
    expect(() => parseNseIndices('Index Name,Index Date,Closing Index Value\n')).toThrow(
      'NSE index file has no indices',
    );
  });
});

describe('parseBseIndices', () => {
  const { rows, warnings } = parseBseIndices(fixture('allindices_22102026.csv'));
  const byCode = (id: string) => rows.find((r) => r.id === id);

  it('reads every row, with US-style dates and volumes in crores', () => {
    expect(rows).toHaveLength(12);
    expect(warnings).toEqual([]);
    expect(byCode('bse:sensex')).toEqual({
      id: 'bse:sensex',
      provider: 'bse',
      name: 'BSE SENSEX',
      basis: 'price',
      currency: 'INR',
      date: '2026-10-22',
      open: 73343.33,
      high: 73720.83,
      low: 73005.11,
      close: 73249.39,
      change: -460.3,
      changeRatio: -0.0062,
      volume: 2.44e7,
      turnover: 1933.71e7,
      pe: 19.11,
      pb: 3.95,
      dividendYield: 0.0112,
    });
  });

  it('leaves blank cells out and marks what it cannot classify', () => {
    expect(byCode('bse:dol30')?.currency).toBe('USD');
    expect(byCode('bse:bseser')).not.toHaveProperty('changeRatio');
    expect(byCode('bse:telcom')?.pb).toBe(-4.12);
    expect(byCode('bse:bsequi')?.name).toBe('BSE Quality Index');
    expect(byCode('bse:goi10')).toMatchObject({ basis: 'unknown', close: 96.37 });
    expect(byCode('bse:b52l1i')).toMatchObject({ basis: 'unknown', close: 2673.8 });
    expect(byCode('bse:b52l1i')).not.toHaveProperty('open');
    expect(byCode('bse:icblot')?.basis).toBe('unknown');
  });

  it('rejects an error page', () => {
    expect(() => parseBseIndices('<!DOCTYPE html><html></html>')).toThrow(
      'BSE index file headings have changed',
    );
  });
});
