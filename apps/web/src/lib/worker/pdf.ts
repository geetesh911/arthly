// SPDX-License-Identifier: AGPL-3.0-only
// Reads PDFs in the data worker. pdf.js parses in this same thread rather than starting a worker
// of its own, and both halves load only when a PDF is added.
import { pdfLayout, pdfLines, type PdfPage } from '@pv/core';

export async function readPdf(bytes: Uint8Array, password?: string): Promise<PdfPage[]> {
  const [pdfjs, parser] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs'),
  ]);
  // When this is set, pdf.js parses in the calling thread.
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = parser;
  return pdfLines(await pdfLayout(pdfjs, bytes, password));
}
