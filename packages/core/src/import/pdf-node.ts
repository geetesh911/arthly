// SPDX-License-Identifier: AGPL-3.0-only
// Reads PDFs under Node, for tests and scripts. Node needs pdf.js's legacy build.
import { pdfLayout, pdfLines } from './pdf.ts';
import type { PdfPage } from './types.ts';

export async function readPdfLayout(bytes: Uint8Array, password?: string) {
  return pdfLayout(await import('pdfjs-dist/legacy/build/pdf.mjs'), bytes, password);
}

export async function readPdf(bytes: Uint8Array, password?: string): Promise<PdfPage[]> {
  return pdfLines(await readPdfLayout(bytes, password));
}
