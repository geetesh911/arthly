// SPDX-License-Identifier: AGPL-3.0-only
// The data key (DK) encrypts everything. The keyring holds DK wrapped under each way of unlocking.
// The keyring isn't secret, but it is signed with DK, so a copy changed outside the app is rejected.
import { sha256 } from '@noble/hashes/sha2.js';
import { argon2id } from 'hash-wasm';

import { randomId } from '../model/ids.ts';
import { base32Decode, base32Encode } from '../util/base32.ts';
import { type Bytes, equalBytes, fromBase64, randomBytes, toBase64, utf8 } from '../util/bytes.ts';
import { canonicalJson } from '../util/json.ts';

export interface KdfParams {
  alg: 'argon2id';
  /** Memory in KiB. */
  m: number;
  t: number;
  p: number;
  salt: string;
}

export const DEFAULT_KDF: Omit<KdfParams, 'salt'> = { alg: 'argon2id', m: 65536, t: 3, p: 1 };

export type WrapType = 'passphrase' | 'recovery' | 'passkey';

export interface Wrap {
  id: string;
  type: WrapType;
  iv: string;
  ct: string;
  /** Passphrase wraps carry their own KDF settings, so they can be tuned later. */
  kdf?: KdfParams;
  credentialId?: string;
  prfSalt?: string;
  label?: string;
  updated: string;
}

interface Sealed {
  iv: string;
  ct: string;
}

export interface Keyring {
  format: 1;
  vaultId: string;
  created: string;
  /** AES-GCM of a constant under DK, to tell whether a key belongs to this vault. */
  check: Sealed;
  wraps: Wrap[];
  revoked: string[];
  /** AES-GCM under DK of the SHA-256 of everything else. */
  sig: Sealed;
}

export class UnlockError extends Error {
  override name = 'UnlockError';
}

const CHECK_TEXT = 'pv-check';

const aesKey = (raw: Bytes, extractable: boolean) =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);

async function seal(key: CryptoKey, aad: string, plain: Bytes): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8.encode(aad) },
    key,
    plain,
  );

  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

async function unseal(key: CryptoKey, aad: string, sealed: Sealed): Promise<Bytes | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.iv), additionalData: utf8.encode(aad) },
      key,
      fromBase64(sealed.ct),
    );

    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

async function hkdf(input: Bytes, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function passphraseKek(passphrase: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2id({
    password: passphrase.normalize('NFKC'),
    salt: fromBase64(kdf.salt),
    iterations: kdf.t,
    parallelism: kdf.p,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: 'binary',
  });

  return aesKey(new Uint8Array(raw), false);
}

const recoveryKek = (code: string) => hkdf(parseRecoveryCode(code), 'pv-recovery');
const passkeyKek = (prfOutput: Bytes) => hkdf(prfOutput, 'pv-passkey');

/** Non-revoked wraps. */
export function activeWraps(ring: Keyring, type?: WrapType): Wrap[] {
  const revoked = new Set(ring.revoked);

  return ring.wraps.filter((w) => !revoked.has(w.id) && (!type || w.type === type));
}

/** 20 random bytes as 8 groups of 4 base32 characters. */
export function formatRecoveryCode(bytes: Uint8Array): string {
  return base32Encode(bytes).toUpperCase().match(/.{4}/g)!.join('-');
}

export function parseRecoveryCode(code: string): Bytes {
  let bytes: Bytes;

  try {
    bytes = base32Decode(code);
  } catch {
    throw new UnlockError('A recovery code only has letters A–Z and digits 2–7');
  }

  if (bytes.length !== 20) {
    throw new UnlockError('A recovery code has 32 letters and digits');
  }

  return bytes;
}

function digest(ring: Keyring): Bytes {
  const { sig: _sig, ...rest } = ring;
  const body = {
    ...rest,
    wraps: [...rest.wraps].sort((a, b) => a.id.localeCompare(b.id)),
    revoked: [...rest.revoked].sort(),
  };

  return new Uint8Array(sha256(utf8.encode(canonicalJson(body))));
}

async function sign(ring: Keyring, dk: CryptoKey): Promise<Keyring> {
  return { ...ring, sig: await seal(dk, `${ring.vaultId}:keyring`, digest(ring)) };
}

/** True when the keyring was signed with dk and hasn't changed since. */
export async function verifyKeyring(ring: Keyring, dk: CryptoKey): Promise<boolean> {
  if (!ring.sig) {
    return false;
  }

  const signed = await unseal(dk, `${ring.vaultId}:keyring`, ring.sig);

  return signed !== null && equalBytes(signed, digest(ring));
}

/** True when dk is this vault's data key. */
export async function verifyKey(ring: Keyring, dk: CryptoKey): Promise<boolean> {
  const plain = await unseal(dk, `${ring.vaultId}:check`, ring.check);

  return plain !== null && utf8.decode(plain) === CHECK_TEXT;
}

async function addWrap(
  ring: Keyring,
  dk: CryptoKey,
  kek: CryptoKey,
  fields: Pick<Wrap, 'type'> & Partial<Wrap>,
  replaceType: boolean,
  now: Date,
): Promise<Keyring> {
  const id = randomId('wrap');
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dk));
  const wrap: Wrap = {
    id,
    ...fields,
    ...(await seal(kek, `${ring.vaultId}:wrap:${id}`, raw)),
    updated: now.toISOString(),
  };
  const old = replaceType ? activeWraps(ring, fields.type).map((w) => w.id) : [];

  return sign(
    { ...ring, wraps: [...ring.wraps, wrap], revoked: [...new Set([...ring.revoked, ...old])] },
    dk,
  );
}

export interface CreateOptions {
  passphrase: string;
  kdf?: Omit<KdfParams, 'salt'>;
  now?: Date;
}

export async function createVault(
  options: CreateOptions,
): Promise<{ keyring: Keyring; dk: CryptoKey; recoveryCode: string }> {
  const now = options.now ?? new Date();
  const dk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const vaultId = randomId('vault');
  const empty: Keyring = {
    format: 1,
    vaultId,
    created: now.toISOString(),
    check: await seal(dk, `${vaultId}:check`, utf8.encode(CHECK_TEXT)),
    wraps: [],
    revoked: [],
    sig: { iv: '', ct: '' },
  };
  const withPassphrase = await setPassphrase(empty, dk, options.passphrase, {
    kdf: options.kdf,
    now,
  });
  const recovery = await newRecoveryCode(withPassphrase, dk, now);

  return { keyring: recovery.keyring, dk, recoveryCode: recovery.code };
}

/** Adds a passphrase wrap and revokes the old ones. Nothing is re-encrypted. */
export async function setPassphrase(
  ring: Keyring,
  dk: CryptoKey,
  passphrase: string,
  options: { kdf?: Omit<KdfParams, 'salt'> | undefined; now?: Date } = {},
): Promise<Keyring> {
  const kdf: KdfParams = { ...(options.kdf ?? DEFAULT_KDF), salt: toBase64(randomBytes(16)) };
  const kek = await passphraseKek(passphrase, kdf);

  return addWrap(ring, dk, kek, { type: 'passphrase', kdf }, true, options.now ?? new Date());
}

/** Makes a new recovery code and revokes the old one. The code is shown once. */
export async function newRecoveryCode(
  ring: Keyring,
  dk: CryptoKey,
  now = new Date(),
): Promise<{ keyring: Keyring; code: string }> {
  const code = formatRecoveryCode(randomBytes(20));
  const keyring = await addWrap(ring, dk, await recoveryKek(code), { type: 'recovery' }, true, now);

  return { keyring, code };
}

export async function addPasskey(
  ring: Keyring,
  dk: CryptoKey,
  passkey: { credentialId: string; prfSalt: string; prfOutput: Bytes; label: string },
  now = new Date(),
): Promise<Keyring> {
  const { credentialId, prfSalt, label } = passkey;
  const kek = await passkeyKek(passkey.prfOutput);

  return addWrap(ring, dk, kek, { type: 'passkey', credentialId, prfSalt, label }, false, now);
}

export async function revokeWrap(ring: Keyring, dk: CryptoKey, wrapId: string): Promise<Keyring> {
  return ring.revoked.includes(wrapId)
    ? ring
    : sign({ ...ring, revoked: [...ring.revoked, wrapId] }, dk);
}

async function firstUnwrap(ring: Keyring, wraps: Wrap[], kek: (w: Wrap) => Promise<CryptoKey>) {
  for (const wrap of wraps) {
    const raw = await unseal(await kek(wrap), `${ring.vaultId}:wrap:${wrap.id}`, wrap);

    if (raw) {
      return aesKey(raw, true);
    }
  }

  return null;
}

export async function unlockWithPassphrase(ring: Keyring, passphrase: string): Promise<CryptoKey> {
  const wraps = activeWraps(ring, 'passphrase').filter((w) => w.kdf);
  const dk = await firstUnwrap(ring, wraps, (w) => passphraseKek(passphrase, w.kdf!));

  if (!dk) {
    throw new UnlockError('Wrong passphrase');
  }

  return dk;
}

export async function unlockWithRecoveryCode(ring: Keyring, code: string): Promise<CryptoKey> {
  const kek = await recoveryKek(code);
  const dk = await firstUnwrap(ring, activeWraps(ring, 'recovery'), async () => kek);

  if (!dk) {
    throw new UnlockError('Wrong recovery code');
  }

  return dk;
}

export async function unlockWithPasskey(
  ring: Keyring,
  credentialId: string,
  prfOutput: Bytes,
): Promise<CryptoKey> {
  const kek = await passkeyKek(prfOutput);
  const wraps = activeWraps(ring, 'passkey').filter((w) => w.credentialId === credentialId);
  const dk = await firstUnwrap(ring, wraps, async () => kek);

  if (!dk) {
    throw new UnlockError('This passkey can no longer unlock the vault');
  }

  return dk;
}

/** True when both hold the same wraps and revocations. */
export function sameKeyring(a: Keyring, b: Keyring): boolean {
  const summary = (r: Keyring) =>
    `${r.vaultId}|${r.wraps
      .map((w) => w.id)
      .sort()
      .join()}|${[...r.revoked].sort().join()}`;

  return summary(a) === summary(b);
}

/**
 * Merges another copy of the keyring into ours: wraps by id, revocations by value.
 * A copy that isn't signed with DK is ignored.
 */
export async function mergeKeyrings(
  ours: Keyring,
  theirs: Keyring,
  dk: CryptoKey,
): Promise<{ keyring: Keyring; rejected: boolean }> {
  if (ours.vaultId !== theirs.vaultId) {
    throw new UnlockError('These keyrings belong to different vaults');
  }

  if (!(await verifyKeyring(theirs, dk))) {
    return { keyring: ours, rejected: true };
  }

  const wraps = new Map(ours.wraps.map((w) => [w.id, w]));

  for (const w of theirs.wraps) {
    if (!wraps.has(w.id)) {
      wraps.set(w.id, w);
    }
  }

  const merged: Keyring = {
    ...ours,
    wraps: [...wraps.values()].sort((x, y) => x.id.localeCompare(y.id)),
    revoked: [...new Set([...ours.revoked, ...theirs.revoked])].sort(),
  };

  return { keyring: sameKeyring(merged, ours) ? ours : await sign(merged, dk), rejected: false };
}
