// SPDX-License-Identifier: AGPL-3.0-only
// A chunk is `"PVC1" | nonce (12) | AES-256-GCM(gzip(JSON))`, with AAD `<vaultId>:<path>`.
import { concatBytes, equalBytes, randomBytes, utf8, type Bytes } from '../util/bytes.ts';

const MAGIC = utf8.encode('PVC1');
const NONCE_LENGTH = 12;

export class ChunkError extends Error {
  override name = 'ChunkError';
}

async function pipe(
  bytes: Bytes,
  transform: CompressionStream | DecompressionStream,
): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const gzip = (bytes: Bytes) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes: Bytes) => pipe(bytes, new DecompressionStream('gzip'));

export function chunkAad(vaultId: string, path: string): Bytes {
  return utf8.encode(`${vaultId}:${path}`);
}

export async function sealChunk(
  key: CryptoKey,
  vaultId: string,
  path: string,
  payload: unknown,
): Promise<Bytes> {
  const nonce = randomBytes(NONCE_LENGTH);
  const plain = await gzip(utf8.encode(JSON.stringify(payload)));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: chunkAad(vaultId, path) },
    key,
    plain,
  );
  return concatBytes(MAGIC, nonce, new Uint8Array(sealed));
}

export async function openChunk<T = unknown>(
  key: CryptoKey,
  vaultId: string,
  path: string,
  bytes: Uint8Array,
): Promise<T> {
  if (bytes.length < MAGIC.length + NONCE_LENGTH + 16 || !equalBytes(bytes.subarray(0, 4), MAGIC)) {
    throw new ChunkError(`${path} is not a chunk`);
  }
  const nonce = bytes.slice(4, 4 + NONCE_LENGTH);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: chunkAad(vaultId, path) },
      key,
      bytes.slice(4 + NONCE_LENGTH),
    );
  } catch {
    throw new ChunkError(`${path} failed to decrypt`);
  }
  return JSON.parse(utf8.decode(await gunzip(new Uint8Array(plain)))) as T;
}
