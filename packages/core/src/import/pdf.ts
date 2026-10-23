// SPDX-License-Identifier: AGPL-3.0-only
// The text of a PDF as rows, read with pdf.js. The browser and Node need different builds of
// pdf.js, so the caller passes in the one it loaded.
import type * as PdfJs from 'pdfjs-dist';
import type { PdfPage } from './types.ts';

export interface PdfRow {
  /** The baseline's height above the bottom of the page. */
  y: number;
  /** Pieces of text, left to right, each with its left edge. */
  pieces: { x: number; text: string }[];
}

export interface PdfLayout {
  width: number;
  height: number;
  /** Top to bottom. */
  rows: PdfRow[];
}

/** Each page's rows of text. Pieces whose baselines are within 2 points share a row. */
export async function pdfLayout(
  pdfjs: typeof PdfJs,
  bytes: Uint8Array,
  password?: string,
): Promise<PdfLayout[]> {
  // pdf.js takes over the buffer it is given, and the caller still needs the file.
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, password });
  try {
    const pdf = await task.promise;
    const pages: PdfLayout[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const rows: PdfRow[] = [];
      for (const item of (await page.getTextContent()).items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [, , , , x = 0, y = 0] = item.transform as number[];
        let row = rows.find((r) => Math.abs(r.y - y) <= 2);
        if (!row) rows.push((row = { y, pieces: [] }));
        row.pieces.push({ x, text: item.str });
      }
      for (const row of rows) row.pieces.sort((a, b) => a.x - b.x);
      pages.push({ width, height, rows: rows.sort((a, b) => b.y - a.y) });
    }
    return pages;
  } catch (error) {
    if ((error as Error).name === 'PasswordException')
      throw new Error('This PDF has a password. Save a copy without one, then add that.', {
        cause: error,
      });
    throw error;
  } finally {
    await task.destroy();
  }
}

/** Each row as one line, its pieces joined by single spaces. */
export function pdfLines(layout: PdfLayout[]): PdfPage[] {
  return layout.map((page) => ({
    lines: page.rows.map((row) =>
      row.pieces
        .map((p) => p.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  }));
}
