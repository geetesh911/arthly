// SPDX-License-Identifier: AGPL-3.0-only
// Parsers for AMFI's NAVAll.txt and the exchanges' UDiFF bhavcopy files.
import type { AmfiRow, ExchangeRow } from './format.ts';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "21-Oct-2026" → "2026-10-21" */
export function amfiDate(text: string): string | undefined {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text.trim());

  if (!m) {
    return undefined;
  }

  const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;

  if (month === 0) {
    return undefined;
  }

  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

/**
 * AMFI's semicolon-separated file. Columns are found by heading. Lines such as
 * "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)" set the category for the schemes below.
 */
export function parseAmfi(text: string): { date: string; rows: AmfiRow[] } {
  const lines = text.split(/\r?\n/);
  const head = (lines[0] ?? '').split(';').map((h) => h.trim().toLowerCase());
  const col = (prefix: string) => head.findIndex((h) => h.startsWith(prefix));
  const c = {
    code: col('scheme code'),
    isin: col('isin div payout'),
    reinvest: col('isin div reinvestment'),
    name: col('scheme name'),
    plan: col('plan'),
    option: col('option'),
    nav: col('net asset value'),
    date: col('date'),
  };

  if (c.code < 0 || c.name < 0 || c.nav < 0 || c.date < 0) {
    throw new Error('NAVAll.txt headings have changed');
  }

  const clean = (s: string | undefined) => (s && s.trim() !== '-' ? s.trim() : '');
  let category = '';
  let latest = '';
  const rows: AmfiRow[] = [];

  for (const line of lines.slice(1)) {
    const heading = /^\s*(?:Open|Close|Interval) Ended Schemes\s*\((.*)\)\s*$/.exec(line);

    if (heading) {
      category = heading[1]!.trim();
      continue;
    }

    const p = line.split(';');

    if (p.length < 5 || !/^\d+$/.test(clean(p[c.code]))) {
      continue;
    }

    const nav = Number(clean(p[c.nav]));
    const date = amfiDate(clean(p[c.date]));

    if (!(nav > 0) || !date) {
      continue;
    }

    const name = [p[c.name], c.plan >= 0 ? p[c.plan] : '', c.option >= 0 ? p[c.option] : '']
      .map(clean)
      .filter(Boolean)
      .join(' ');

    rows.push([
      clean(p[c.code]),
      clean(p[c.isin]),
      clean(p[c.reinvest]),
      name,
      category,
      nav,
      date,
    ]);

    if (date > latest) {
      latest = date;
    }
  }

  return { date: latest, rows };
}

/** One CSV line; the bhavcopy has no quoted commas, but quotes are handled anyway. */
export function csvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;

  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }

  out.push(cell);

  return out.map((s) => s.trim());
}

/** NSE's and BSE's cash-market bhavcopy in the UDiFF format (TradDt, ISIN, TckrSymb, SctySrs, ClsPric). */
export function parseBhavcopy(text: string): { date: string; rows: ExchangeRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = csvLine(lines[0] ?? '').map((h) => h.toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const c = {
    date: col('TradDt'),
    isin: col('ISIN'),
    symbol: col('TckrSymb'),
    series: col('SctySrs'),
    close: col('ClsPric'),
    segment: col('Sgmt'),
  };

  if (c.date < 0 || c.symbol < 0 || c.close < 0) {
    throw new Error('Bhavcopy headings have changed');
  }

  let date = '';
  const rows: ExchangeRow[] = [];

  for (const line of lines.slice(1)) {
    const p = csvLine(line);

    if (c.segment >= 0 && p[c.segment] && p[c.segment] !== 'CM') {
      continue;
    }

    const close = Number(p[c.close]);

    if (!(close > 0) || !p[c.symbol]) {
      continue;
    }

    rows.push([
      p[c.symbol]!,
      c.series >= 0 ? (p[c.series] ?? '') : '',
      c.isin >= 0 ? (p[c.isin] ?? '') : '',
      close,
    ]);

    if ((p[c.date] ?? '') > date) {
      date = p[c.date]!;
    }
  }

  return { date, rows };
}
