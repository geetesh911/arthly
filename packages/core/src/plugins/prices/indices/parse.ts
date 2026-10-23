// SPDX-License-Identifier: AGPL-3.0-only
// NSE's daily index snapshot (ind_close_all_DDMMYYYY.csv) and BSE's daily all-indices file
// (allindices_DDMMYYYY.csv). Both list every index the exchange published that day.
import { isISODate, type ISODate, makeDate } from '../../../util/dates.ts';
import { csvLine } from '../feed/parse.ts';

import type { IndexObservation, IndexProvider, ReturnBasis } from './types.ts';

export interface ParsedIndices {
  rows: IndexObservation[];
  /** Rows left out, and why. */
  warnings: string[];
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Nifty's fixed-income indices are total return, apart from the clean-price one. */
function nseBasis(name: string): ReturnBasis {
  if (/\bVIX\b/i.test(name)) {
    return 'volatility';
  }

  if (/clean price/i.test(name)) {
    return 'price';
  }

  // Dividend points, and strategy indices built on futures, leverage or arbitrage.
  if (/dividend points|inverse|leverage|futures|arbitrage/i.test(name)) {
    return 'unknown';
  }

  if (/\bTR\b|total return/i.test(name)) {
    return 'total';
  }

  if (/G-?Sec|Bond|1D Rate|T-Bill|SDL|Gilt|Money Market/i.test(name)) {
    return 'total';
  }

  return 'price';
}

/** BSE doesn't say which of its bond and strategy indices include interest. */
function bseBasis(name: string): ReturnBasis {
  if (/G-?Sec|Bond|Liquid Rate|Inverse|Leverage/i.test(name)) {
    return 'unknown';
  }

  return 'price';
}

/** A number, nothing for a blank or a dash, or NaN when the cell holds something else. */
function number(cell: string | undefined): number | undefined {
  const text = (cell ?? '').replaceAll(',', '');

  if (text === '' || text === '-') {
    return undefined;
  }

  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : NaN;
}

/** Percent to fraction, without float noise: -0.54 → -0.0054. */
const fraction = (n: number | undefined) =>
  n === undefined ? undefined : Number((n / 100).toPrecision(12));

interface Layout {
  provider: IndexProvider;
  label: string;
  heads: { name: string; date: string; close: string } & Record<string, string>;
  date: (text: string) => ISODate | undefined;
  id: (cells: (name: string) => string) => string;
  basis: (name: string) => ReturnBasis;
  /** Volume is in shares at NSE and crores of shares at BSE. */
  volumeScale: number;
}

function parse(text: string, layout: Layout): ParsedIndices {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const head = csvLine(lines[0] ?? '').map((h) => h.toLowerCase());
  const col = Object.fromEntries(
    Object.entries(layout.heads).map(([k, h]) => [k, head.indexOf(h.toLowerCase())]),
  );

  if (col.name! < 0 || col.date! < 0 || col.close! < 0) {
    throw new Error(`${layout.label} index file headings have changed`);
  }

  const warnings: string[] = [];
  const found = new Map<string, IndexObservation | null>();

  for (const line of lines.slice(1)) {
    const p = csvLine(line);
    const cell = (k: string) => (col[k]! >= 0 ? (p[col[k]!] ?? '') : '');
    const name = cell('name');

    if (!name) {
      continue;
    }

    const values = {
      open: number(cell('open')),
      high: number(cell('high')),
      low: number(cell('low')),
      close: number(cell('close')),
      change: number(cell('change')),
      changeRatio: number(cell('changePct')),
      volume: number(cell('volume')),
      turnover: number(cell('turnover')),
      pe: number(cell('pe')),
      pb: number(cell('pb')),
      dividendYield: number(cell('dividendYield')),
    };
    const date = layout.date(cell('date'));
    const warn = (why: string) => warnings.push(`${layout.label}: ${name} ${why}`);

    if (Object.values(values).some((n) => Number.isNaN(n))) {
      warn('has a malformed number');
    } else if (!date) {
      warn('has an impossible date');
    } else if (!(values.close! > 0)) {
      warn('has no closing level');
    } else {
      const row: IndexObservation = {
        id: `${layout.provider}:${slug(layout.id(cell))}`,
        provider: layout.provider,
        name,
        basis: layout.basis(name),
        currency: /\bUSD\b|DOLLEX/i.test(name) ? 'USD' : 'INR',
        date,
        close: values.close!,
      };
      const extra = {
        open: values.open,
        high: values.high,
        low: values.low,
        change: values.change,
        changeRatio: fraction(values.changeRatio),
        volume:
          values.volume === undefined ? undefined : Math.round(values.volume * layout.volumeScale),
        turnover: values.turnover === undefined ? undefined : Math.round(values.turnover * 1e7),
        pe: values.pe,
        pb: values.pb,
        dividendYield: fraction(values.dividendYield),
      };

      for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined) {
          (row as unknown as Record<string, number>)[k] = v;
        }
      }

      const seen = found.get(row.id);

      if (seen === undefined) {
        found.set(row.id, row);
      } else if (seen && (seen.date !== row.date || seen.close !== row.close)) {
        found.set(row.id, null);
        warn('is listed twice with different levels');
      }
    }
  }

  const rows = [...found.values()].filter((r): r is IndexObservation => r !== null);

  if (!rows.length && !warnings.length) {
    throw new Error(`${layout.label} index file has no indices`);
  }

  return { rows, warnings };
}

function checkedDate(year: number, month: number, day: number): ISODate | undefined {
  const date = makeDate(year, month, day);

  return isISODate(date) ? date : undefined;
}

const VALUES = {
  open: 'Open',
  high: 'High',
  low: 'Low',
  change: 'Points Change',
  changePct: 'Change(%)',
  pe: 'P/E',
  pb: 'P/B',
  dividendYield: 'Div Yield',
};

export function parseNseIndices(text: string): ParsedIndices {
  return parse(text, {
    provider: 'nse',
    label: 'NSE',
    heads: {
      ...VALUES,
      name: 'Index Name',
      date: 'Index Date',
      open: 'Open Index Value',
      high: 'High Index Value',
      low: 'Low Index Value',
      close: 'Closing Index Value',
      volume: 'Volume',
      turnover: 'Turnover (Rs. Cr.)',
    },
    date: (t) => {
      const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);

      return m ? checkedDate(+m[3]!, +m[2]!, +m[1]!) : undefined;
    },
    id: (cell) => cell('name'),
    basis: nseBasis,
    volumeScale: 1,
  });
}

export function parseBseIndices(text: string): ParsedIndices {
  return parse(text, {
    provider: 'bse',
    label: 'BSE',
    heads: {
      ...VALUES,
      name: 'Index Name',
      code: 'Index Code',
      date: 'Date',
      close: 'Close',
      volume: 'Volume(Cr.)',
      turnover: 'Turnover (Rs.Cr.)',
    },
    date: (t) => {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);

      return m ? checkedDate(+m[3]!, +m[1]!, +m[2]!) : undefined;
    },
    id: (cell) => cell('code') || cell('name'),
    basis: bseBasis,
    volumeScale: 1e7,
  });
}
