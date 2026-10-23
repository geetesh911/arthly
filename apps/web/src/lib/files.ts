// SPDX-License-Identifier: AGPL-3.0-only
import { unzip } from '@pv/core';

/** Hands the viewer a file to save. */
export function saveFile(file: { name: string; mime: string; bytes: Uint8Array }): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: file.mime }));
  const a = document.createElement('a');

  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function readFile(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Swaps each .zip for the files inside it; other files pass through. */
export async function openZips(files: File[]): Promise<File[]> {
  const out: File[] = [];

  for (const file of files) {
    if (!/\.zip$/i.test(file.name)) {
      out.push(file);
      continue;
    }

    const entries = await unzip(await readFile(file));

    if (!entries.length) {
      throw new Error(`${file.name} has no files in it`);
    }

    out.push(...entries.map((e) => new File([e.bytes], e.name)));
  }

  return out;
}
