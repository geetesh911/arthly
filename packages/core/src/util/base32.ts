// SPDX-License-Identifier: AGPL-3.0-only
// RFC 4648 base32, lower case, no padding.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toLowerCase().replace(/[\s-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;

  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);

    if (index < 0) {
      throw new Error(`Not a base32 character: ${ch}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(out);
}
