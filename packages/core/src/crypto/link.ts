// SPDX-License-Identifier: AGPL-3.0-only
// Linking a device with a QR code (see the device linking spec). The new device makes a one-time
// key pair and shows a code that is a hash of its public key. A device with the portfolio open
// checks the request against that code and sends the data key, sealed for that key alone. Both
// halves travel through the user's own Google Drive; this file only does the sealing.
import { sha256 } from '@noble/hashes/sha2.js';

import { base32Encode } from '../util/base32.ts';
import { type Bytes, fromBase64, randomBytes, toBase64, utf8 } from '../util/bytes.ts';

/** How long a request stays good. */
export const LINK_TTL_MS = 10 * 60_000;

/** What a QR code holds before the code, so the scanner can tell it's one of ours. */
const QR_PREFIX = 'arthly-link:';
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const CODE = /^[A-Z2-7]{16}$/;

/** What the new device leaves in Drive. */
export interface LinkRequest {
  format: 1;
  publicKey: string;
  /** Such as "Chrome on macOS", for the other device to show. */
  device: string;
  created: string;
}

/** What the open device leaves in Drive: the portfolio, sealed for the new device. */
export interface LinkReply {
  format: 1;
  publicKey: string;
  iv: string;
  ct: string;
}

/** The portfolio a link opens. */
export interface LinkedPortfolio {
  vaultId: string;
  dk: CryptoKey;
  /** Its folder in Google Drive. */
  folderId: string;
  /** Its name on the device that sent it. */
  name: string;
}

export class LinkError extends Error {
  override name = 'LinkError';
}

/** The files a link uses in the Arthly folder. */
export const linkFiles = (code: string) => ({
  request: `link-${code}.json`,
  reply: `link-${code}-reply.json`,
});

/** The code a public key hashes to: 16 base32 characters, 80 bits. */
export function linkCode(publicKey: Uint8Array): string {
  return base32Encode(sha256(publicKey).subarray(0, 10)).toUpperCase();
}

/** The code as shown, in groups of four. */
export function formatLinkCode(code: string): string {
  return code.match(/.{4}/g)!.join('-');
}

export const linkQrText = (code: string) => `${QR_PREFIX}${code}`;

/** The code in a scanned QR code or typed by hand, or null when it isn't one. */
export function readLinkCode(text: string): string | null {
  const body = text.startsWith(QR_PREFIX) ? text.slice(QR_PREFIX.length) : text;
  // Base32 has no 0, 1 or 8, and in many fonts they look like O, I and B.
  const code = body
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replaceAll('0', 'O')
    .replaceAll('1', 'I')
    .replaceAll('8', 'B');

  return CODE.test(code) ? code : null;
}

/** The new device's half: a key pair, its code, and the request to leave in Drive. */
export async function newLink(
  device: string,
  now: Date,
): Promise<{ code: string; request: LinkRequest; privateKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

  return {
    code: linkCode(publicKey),
    request: { format: 1, publicKey: toBase64(publicKey), device, created: now.toISOString() },
    privateKey: pair.privateKey,
  };
}

/** The AES key both sides reach from one's private key and the other's public key. */
async function sharedKey(privateKey: CryptoKey, publicKey: Bytes, code: string) {
  const theirs = await crypto.subtle.importKey('raw', publicKey, ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: utf8.encode(`${QR_PREFIX}${code}`),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Binds the sealed reply to the code and to the sender's public key. */
const replyAad = (code: string, publicKey: string) =>
  utf8.encode(`${QR_PREFIX}${code}:${publicKey}`);

/**
 * Checks that a request belongs to the code the user scanned or typed, and is recent. Gives the
 * new device's public key.
 */
export function checkLinkRequest(code: string, request: LinkRequest, now: Date): Bytes {
  let theirs: Bytes;

  try {
    theirs = fromBase64(request.publicKey);
  } catch {
    throw new LinkError('That request isn’t from Arthly');
  }

  if (request.format !== 1 || linkCode(theirs) !== code) {
    throw new LinkError(
      'The device that asked doesn’t match this code. Make a new code and try again.',
    );
  }

  if (Math.abs(now.getTime() - Date.parse(request.created)) > LINK_TTL_MS) {
    throw new LinkError('This code has expired. Make a new one on the other device.');
  }

  return theirs;
}

/** The open device's half: checks the request, then seals the portfolio for it. */
export async function answerLink(
  code: string,
  request: LinkRequest,
  portfolio: LinkedPortfolio,
  now: Date,
): Promise<LinkReply> {
  const theirs = checkLinkRequest(code, request, now);
  const pair = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  let key: CryptoKey;

  try {
    key = await sharedKey(pair.privateKey, theirs, code);
  } catch {
    throw new LinkError('That request isn’t from Arthly');
  }

  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', portfolio.dk));
  const plain = utf8.encode(
    JSON.stringify({
      vaultId: portfolio.vaultId,
      key: toBase64(raw),
      folderId: portfolio.folderId,
      name: portfolio.name,
    }),
  );
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: replyAad(code, publicKey) },
    key,
    plain,
  );

  return { format: 1, publicKey, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

/** Opens the reply with the new device's private key. */
export async function openLinkReply(
  code: string,
  privateKey: CryptoKey,
  reply: LinkReply,
): Promise<LinkedPortfolio> {
  try {
    if (reply.format !== 1) {
      throw new Error('Unknown format');
    }

    const key = await sharedKey(privateKey, fromBase64(reply.publicKey), code);
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(reply.iv),
        additionalData: replyAad(code, reply.publicKey),
      },
      key,
      fromBase64(reply.ct),
    );
    const sent = JSON.parse(utf8.decode(new Uint8Array(plain))) as Record<string, unknown>;
    const { vaultId, folderId, name } = sent;

    if (typeof vaultId !== 'string' || typeof folderId !== 'string' || typeof name !== 'string') {
      throw new Error('Missing fields');
    }

    const dk = await crypto.subtle.importKey(
      'raw',
      fromBase64(String(sent.key)),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    );

    return { vaultId, dk, folderId, name };
  } catch {
    throw new LinkError('The answer from the other device couldn’t be opened. Make a new code.');
  }
}
