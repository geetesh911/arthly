// SPDX-License-Identifier: AGPL-3.0-only
// Every source file in the repo starts with an SPDX licence header.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const SKIP = new Set([
  'node_modules',
  'fixtures',
  'build',
  'dist',
  '.svelte-kit',
  'test-results',
  'playwright-report',
]);
const HEADER = /^(\/\/|<!--|\/\*|#) SPDX-License-Identifier: AGPL-3\.0-only/;
// Components copied from shadcn-svelte keep their MIT licence (see that folder's LICENSE.md).
const VENDORED = /^apps\/web\/src\/lib\/(components\/ui\/|utils\.ts$)/;
const MIT = /^(\/\/|<!--) SPDX-License-Identifier: MIT/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) {
      return [];
    }

    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return /\.(ts|js|svelte|css)$/.test(name) ? [path] : [];
  });
}

describe('source files', () => {
  it('all start with an SPDX header', () => {
    const files = ['packages', 'apps'].flatMap((d) => sourceFiles(join(root, d)));

    expect(files.length).toBeGreaterThan(50);
    const missing = files
      .map((f) => f.slice(root.length + 1))
      .filter((f) => !(VENDORED.test(f) ? MIT : HEADER).test(readFileSync(join(root, f), 'utf8')));

    expect(missing).toEqual([]);
  });
});
