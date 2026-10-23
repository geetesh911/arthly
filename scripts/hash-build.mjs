// SPDX-License-Identifier: AGPL-3.0-only
// Prints the SHA-256 of a build folder: of every file's path and contents, in path order.
// Release notes carry this hash, so anyone can check the hosted copy matches the source.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] ?? 'apps/web/build';
const files = [];

(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      walk(path);
    } else {
      files.push(path);
    }
  }
})(root);

const hash = createHash('sha256');

for (const path of files) {
  hash.update(relative(root, path).replaceAll('\\', '/'));
  hash.update('\0');
  hash.update(readFileSync(path));
  hash.update('\0');
}

console.log(hash.digest('hex'));
