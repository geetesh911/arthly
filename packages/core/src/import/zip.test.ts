// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { unzip } from './zip.ts';

const read = (path: string) => new Uint8Array(readFileSync(join(import.meta.dirname, '..', path)));

describe('unzip', () => {
  it('opens a zip made by macOS, leaving out folders and hidden files', async () => {
    // Made with `ditto -c -k --sequesterRsrc --keepParent`, as Finder's Compress does.
    const entries = await unzip(read('import/fixtures/statements.zip'));

    expect(entries.map((e) => e.name).sort()).toEqual(['mf.xlsx', 'stocks.xlsx']);
    const byName = new Map(entries.map((e) => [e.name, e.bytes]));

    expect(byName.get('mf.xlsx')).toEqual(
      read('plugins/importers/groww-mf-holdings/fixtures/holdings.xlsx'),
    );
    expect(byName.get('stocks.xlsx')).toEqual(
      read('plugins/importers/groww-stock-holdings/fixtures/holdings.xlsx'),
    );
  });

  it('reads files stored without compression', async () => {
    const [entry] = await unzip(read('import/fixtures/stored.zip'));

    expect(entry?.name).toBe('a.csv');
    expect(new TextDecoder().decode(entry?.bytes)).toBe('Date,Amount\n2026-01-01,100\n');
  });

  it('says so when a zip is password-protected', async () => {
    await expect(unzip(read('import/fixtures/locked.zip'))).rejects.toThrow('password-protected');
  });

  it('says so when a file is not a zip, or is cut short', async () => {
    await expect(unzip(new TextEncoder().encode('Date,Amount'))).rejects.toThrow(
      "This isn't a zip file",
    );
    const zip = read('import/fixtures/statements.zip');
    const cut = new Uint8Array([...zip.subarray(0, 4000), ...zip.subarray(zip.length - 2000)]);

    await expect(unzip(cut)).rejects.toThrow("This isn't a zip file");
  });
});

describe('unzip limits', () => {
  it('stops once the unpacked files pass the limit', async () => {
    const zip = read('import/fixtures/statements.zip');

    await expect(unzip(zip, 1000)).rejects.toThrow('too big');
    expect(await unzip(zip, 1_000_000)).toHaveLength(2);
  });
});
