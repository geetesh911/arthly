// SPDX-License-Identifier: AGPL-3.0-only
// Prints a masked outline of a PDF statement, to share when asking for a new importer.
// Run: node packages/core/scripts/pdf-outline.ts statement.pdf
import { readFile } from 'node:fs/promises';
import { outline } from '../src/import/pdf-outline.ts';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node packages/core/scripts/pdf-outline.ts <statement.pdf>');
  process.exit(1);
}
try {
  console.log(await outline(new Uint8Array(await readFile(path))));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
