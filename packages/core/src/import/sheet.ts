// SPDX-License-Identifier: AGPL-3.0-only
// Reading spreadsheets by heading text rather than by cell position.
import { isISODate, makeDate, type ISODate } from '../util/dates.ts';
import type { Cell, InputFile, PdfPage, Sheet } from './types.ts';

function isoFromDate(d: Date): ISODate {
  return makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Reads a workbook. SheetJS is large, so it loads on first use. */
export async function readSheets(bytes: Uint8Array): Promise<Sheet[]> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(bytes, { type: 'array', cellDates: true, dense: true });
  return book.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
    });
    return {
      name,
      rows: rows.map((row) =>
        row.map((c): Cell => (c instanceof Date ? isoFromDate(c) : ((c as Cell) ?? null))),
      ),
    };
  });
}

export function inputFile(
  name: string,
  bytes: Uint8Array,
  pdf?: (bytes: Uint8Array, password?: string) => Promise<PdfPage[]>,
): InputFile {
  let sheets: Sheet[] | undefined;
  return {
    name,
    bytes,
    async sheets() {
      sheets ??= /\.(xlsx|xls|csv)$/i.test(name) ? await readSheets(bytes) : [];
      return sheets;
    },
    async pdfText(password) {
      if (!pdf) throw new Error('PDF reading is not available here');
      return pdf(bytes, password);
    },
  };
}

export const text = (c: Cell | undefined): string =>
  c === null || c === undefined ? '' : String(c).trim();

export const lower = (c: Cell | undefined): string => text(c).toLowerCase().replace(/\s+/g, ' ');

/** Numbers written as 1,23,456.78, ₹500, 12.5% or (100). Blank, '-' and 'N/A' give undefined. */
export function num(c: Cell | undefined): number | undefined {
  if (typeof c === 'number') return Number.isFinite(c) ? c : undefined;
  const t = text(c)
    .replace(/[₹,\s%]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (t === '' || t === '-' || /^n\/?a$/i.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Finds a date in text: 2026-10-21, 21-10-2026, 21/10/2026 or 21-Oct-2026. */
export function findDate(c: Cell | undefined): ISODate | undefined {
  const t = text(c);
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return isISODate(m[0]) ? m[0] : undefined;
  m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t);
  if (m) {
    const d = makeDate(Number(m[3]), Number(m[2]), Number(m[1]));
    return isISODate(d) ? d : undefined;
  }
  m = /(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{4})/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    const d = makeDate(Number(m[3]), month, Number(m[1]));
    return month > 0 && isISODate(d) ? d : undefined;
  }
  return undefined;
}

/** The first cell whose text passes the test. */
export function findCell(
  rows: Cell[][],
  test: (t: string) => boolean,
): { row: number; col: number } | undefined {
  for (let row = 0; row < rows.length; row++) {
    const cells = rows[row]!;
    for (let col = 0; col < cells.length; col++) if (test(lower(cells[col]))) return { row, col };
  }
  return undefined;
}

/** The first row holding every heading (case and spacing ignored), with each heading's column. */
export function findHeader<K extends string>(
  rows: Cell[][],
  headings: Record<K, string[]>,
): { row: number; col: Record<K, number> } | undefined {
  for (let row = 0; row < rows.length; row++) {
    const cells = rows[row]!.map(lower);
    const col = {} as Record<K, number>;
    let ok = true;
    for (const [key, names] of Object.entries(headings) as [K, string[]][]) {
      const index = cells.findIndex((c) => names.includes(c));
      if (index < 0) {
        ok = false;
        break;
      }
      col[key] = index;
    }
    if (ok) return { row, col };
  }
  return undefined;
}

/** Rows below a header row, stopping at the first row that is completely blank after data began. */
export function rowsBelow(rows: Cell[][], header: number): Cell[][] {
  const out: Cell[][] = [];
  for (const row of rows.slice(header + 1)) {
    const blank = row.every((c) => text(c) === '');
    if (blank) {
      if (out.length > 0) break;
      continue;
    }
    out.push(row);
  }
  return out;
}
