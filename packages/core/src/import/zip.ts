// SPDX-License-Identifier: AGPL-3.0-only
// Opens a .zip of statements with the platform's own deflate, so no library is needed.
// Sizes and offsets come from the central directory, which also covers zips that put them
// after the data, as macOS does.

export interface ZipEntry {
  /** The file's name without its folders. */
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DAMAGED = "This isn't a zip file, or it is damaged.";
const TOO_BIG = 'This zip is too big to open here. Unzip it first, then add the files.';

async function inflate(
  data: Uint8Array<ArrayBuffer>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  let count = 0;
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          count += chunk.byteLength;

          if (count > limit) {
            throw new Error(TOO_BIG);
          }

          controller.enqueue(chunk);
        },
      }),
    );

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The end record sits in the last 22 bytes, unless a comment of up to 64 KB follows it. */
function findEnd(view: DataView): number {
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === END) {
      return at;
    }
  }

  return -1;
}

/**
 * The files in a zip, skipping folders, hidden files and the `__MACOSX` copies macOS adds.
 * Unpacking stops once the files pass `limit` bytes in all.
 */
export async function unzip(bytes: Uint8Array<ArrayBuffer>, limit = Infinity): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);

  if (end < 0) {
    throw new Error(DAMAGED);
  }

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  if (count === 0xffff || at === 0xffffffff) {
    throw new Error(TOO_BIG);
  }

  let unpacked = 0;
  const names = new TextDecoder();
  const entries: ZipEntry[] = [];

  try {
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== CENTRAL) {
        throw new Error(DAMAGED);
      }

      const flags = view.getUint16(at + 8, true);
      const method = view.getUint16(at + 10, true);
      const size = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const local = view.getUint32(at + 42, true);
      const path = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));

      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);

      const name = path.split('/').pop() ?? '';

      if (!name || name.startsWith('.') || path.startsWith('__MACOSX/')) {
        continue;
      }

      if (flags & 1) {
        throw new Error('This zip is password-protected. Unzip it first, then add the files.');
      }

      if (view.getUint32(local, true) !== LOCAL) {
        throw new Error(DAMAGED);
      }

      const start =
        local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      let entry: Uint8Array<ArrayBuffer>;

      if (method === 0) {
        entry = data.slice();
      } else if (method === 8) {
        entry = await inflate(data, limit - unpacked);
      } else {
        throw new Error(
          `${name} is packed in a way the app can't read. Unzip it first, then add the files.`,
        );
      }

      unpacked += entry.byteLength;

      if (unpacked > limit) {
        throw new Error(TOO_BIG);
      }

      entries.push({ name, bytes: entry });
    }
  } catch (error) {
    // Offsets past the end, or deflate data that doesn't decode.
    if (error instanceof RangeError || error instanceof TypeError) {
      throw new Error(DAMAGED, { cause: error });
    }

    throw error;
  }

  return entries;
}
