// SPDX-License-Identifier: AGPL-3.0-only
// A masked outline of a PDF statement: where each piece of text sits, with every digit and every
// word that isn't a known label hidden. It shows a statement's layout without its contents, so it
// can be shared safely when asking for an importer.
import { readPdfLayout } from './pdf-node.ts';

/** Words that are safe to show: headings and labels from EPFO passbooks and bank statements. */
const LABELS = new Set(
  `employees employee employer employers provident fund organisation organization member members
  passbook financial year years establishment id name uan date birth wage wages month months
  transaction transactions type particulars epf eps contribution contributions pension cont due
  int interest updated upto up ob opening closing balance balances total totals transfer transfers
  ins in outs out withdrawal withdrawals cr dr share taxable non claim settlement settled final
  advance vdr ncp days net amount amounts details account rs inr credit debit deposit remarks note
  page of the for to as on by and or from at per no is a an
  jan feb mar apr may jun jul aug sep oct nov dec`.split(/\s+/),
);

function hide(word: string): string {
  if (LABELS.has(word.toLowerCase())) return word;
  if (/^\p{Lu}{2,}$/u.test(word)) return 'ABC';
  return /^\p{Ll}/u.test(word) ? 'abc' : 'Abc';
}

/** Hides every word that isn't a label as Abc, and every digit as 9; punctuation stays. */
export function mask(text: string): string {
  return text.replace(/[\p{L}\p{M}]+/gu, hide).replace(/\p{Nd}/gu, '9');
}

/** One line per row of text, top to bottom: its height on the page, then each piece's left edge. */
export async function outline(bytes: Uint8Array): Promise<string> {
  const pages = await readPdfLayout(bytes);
  const out = [`${pages.length} page(s). Words that aren't labels show as Abc, digits as 9.`];
  for (const [n, page] of pages.entries()) {
    out.push('', `Page ${n + 1} (${Math.round(page.width)} × ${Math.round(page.height)})`);
    for (const row of page.rows)
      out.push(
        `${String(Math.round(row.y)).padStart(4)} │ ` +
          row.pieces.map((p) => `${Math.round(p.x)}:${JSON.stringify(mask(p.text))}`).join('  '),
      );
  }
  return out.join('\n');
}
