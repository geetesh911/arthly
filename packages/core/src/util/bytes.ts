// SPDX-License-Identifier: AGPL-3.0-only
/** Bytes backed by a plain ArrayBuffer, as WebCrypto requires. */
export type Bytes = Uint8Array<ArrayBuffer>;

export const utf8 = {
  encode: (text: string): Bytes => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array): string => new TextDecoder().decode(bytes),
};

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function fromBase64(text: string): Bytes {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
