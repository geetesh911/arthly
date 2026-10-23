// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { randomBytes } from '../util/bytes.ts';
import { ChunkError, openChunk, sealChunk } from './chunk.ts';
import {
  activeWraps,
  addPasskey,
  createVault,
  mergeKeyrings,
  newRecoveryCode,
  revokeWrap,
  sameKeyring,
  setPassphrase,
  unlockWithPasskey,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
  UnlockError,
  verifyKey,
  verifyKeyring,
} from './keyring.ts';

// Cheap settings keep the tests fast; the app uses DEFAULT_KDF.
const kdf = { alg: 'argon2id' as const, m: 256, t: 1, p: 1 };

async function newKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

describe('chunks', () => {
  it('round trip', async () => {
    const key = await newKey();
    const payload = [{ hlc: '1', data: { name: 'Ünïcode ₹' } }];
    const bytes = await sealChunk(key, 'v1', 'log/dev/00000001.pvc', payload);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('PVC1');
    expect(await openChunk(key, 'v1', 'log/dev/00000001.pvc', bytes)).toEqual(payload);
  });

  it('reject a wrong key, path, vault or tampered bytes', async () => {
    const key = await newKey();
    const bytes = await sealChunk(key, 'v1', 'a.pvc', { x: 1 });
    await expect(openChunk(await newKey(), 'v1', 'a.pvc', bytes)).rejects.toThrow(ChunkError);
    await expect(openChunk(key, 'v1', 'b.pvc', bytes)).rejects.toThrow(ChunkError);
    await expect(openChunk(key, 'v2', 'a.pvc', bytes)).rejects.toThrow(ChunkError);
    for (const index of [5, 20, bytes.length - 1]) {
      const tampered = bytes.slice();
      tampered[index]! ^= 1;
      await expect(openChunk(key, 'v1', 'a.pvc', tampered)).rejects.toThrow(ChunkError);
    }
    await expect(openChunk(key, 'v1', 'a.pvc', bytes.slice(0, 10))).rejects.toThrow(ChunkError);
  });
});

describe('keyring', () => {
  it('works with the default Argon2id settings (64 MiB)', async () => {
    const { keyring } = await createVault({ passphrase: 'slow' });
    expect(activeWraps(keyring, 'passphrase')[0]?.kdf).toMatchObject({ m: 65536, t: 3, p: 1 });
    await expect(unlockWithPassphrase(keyring, 'slow')).resolves.toBeDefined();
  });

  it('creates a vault that opens with the passphrase and the recovery code', async () => {
    const { keyring, dk, recoveryCode } = await createVault({ passphrase: 'correct horse', kdf });
    expect(recoveryCode).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(await verifyKey(keyring, dk)).toBe(true);
    expect(await verifyKey(keyring, await unlockWithPassphrase(keyring, 'correct horse'))).toBe(
      true,
    );
    const fromCode = await unlockWithRecoveryCode(
      keyring,
      recoveryCode.toLowerCase().replace(/-/g, ' '),
    );
    expect(await verifyKey(keyring, fromCode)).toBe(true);
    expect(JSON.parse(JSON.stringify(keyring))).toEqual(keyring);
  });

  it('rejects a wrong passphrase, code or key', async () => {
    const { keyring } = await createVault({ passphrase: 'one', kdf });
    await expect(unlockWithPassphrase(keyring, 'two')).rejects.toThrow(UnlockError);
    await expect(unlockWithRecoveryCode(keyring, 'A'.repeat(32))).rejects.toThrow(UnlockError);
    await expect(unlockWithRecoveryCode(keyring, 'ABCD')).rejects.toThrow(UnlockError);
    expect(await verifyKey(keyring, await newKey())).toBe(false);
  });

  it('changes the passphrase by revoking the old wrap', async () => {
    const { keyring, dk } = await createVault({ passphrase: 'old', kdf });
    const changed = await setPassphrase(keyring, dk, 'new', { kdf });
    await expect(unlockWithPassphrase(changed, 'old')).rejects.toThrow(UnlockError);
    expect(await verifyKey(changed, await unlockWithPassphrase(changed, 'new'))).toBe(true);
    expect(activeWraps(changed, 'passphrase')).toHaveLength(1);
    // A copy of the keyring from before the change still opens with the old one (a known limit).
    expect(await verifyKey(keyring, await unlockWithPassphrase(keyring, 'old'))).toBe(true);
  });

  it('replaces the recovery code', async () => {
    const { keyring, dk, recoveryCode } = await createVault({ passphrase: 'p', kdf });
    const next = await newRecoveryCode(keyring, dk);
    await expect(unlockWithRecoveryCode(next.keyring, recoveryCode)).rejects.toThrow(UnlockError);
    expect(
      await verifyKey(next.keyring, await unlockWithRecoveryCode(next.keyring, next.code)),
    ).toBe(true);
  });

  it('unlocks with a passkey PRF output until revoked', async () => {
    const { keyring, dk } = await createVault({ passphrase: 'p', kdf });
    const prfOutput = randomBytes(32);
    const ring = await addPasskey(keyring, dk, {
      credentialId: 'cred1',
      prfSalt: 'salt',
      prfOutput,
      label: 'Pixel 8',
    });
    expect(await verifyKey(ring, await unlockWithPasskey(ring, 'cred1', prfOutput))).toBe(true);
    await expect(unlockWithPasskey(ring, 'cred1', randomBytes(32))).rejects.toThrow(UnlockError);
    await expect(unlockWithPasskey(ring, 'other', prfOutput)).rejects.toThrow(UnlockError);
    const passkey = activeWraps(ring, 'passkey')[0]!;
    const revoked = await revokeWrap(ring, dk, passkey.id);
    await expect(unlockWithPasskey(revoked, 'cred1', prfOutput)).rejects.toThrow(UnlockError);
  });

  it('merges keyrings as a union, whatever the order', async () => {
    const { keyring, dk } = await createVault({ passphrase: 'p', kdf });
    const a = await addPasskey(keyring, dk, {
      credentialId: 'a',
      prfSalt: 's',
      prfOutput: randomBytes(32),
      label: 'A',
    });
    const b = await setPassphrase(keyring, dk, 'q', { kdf });
    const ab = (await mergeKeyrings(a, b, dk)).keyring;
    const ba = (await mergeKeyrings(b, a, dk)).keyring;
    expect(sameKeyring(ab, ba)).toBe(true);
    expect(sameKeyring(ab, a)).toBe(false);
    expect(await verifyKeyring(ab, dk)).toBe(true);
    expect(ab.wraps).toHaveLength(4);
    await expect(unlockWithPassphrase(ab, 'p')).rejects.toThrow(UnlockError);
    expect(await verifyKey(ab, await unlockWithPassphrase(ab, 'q'))).toBe(true);
    const other = await createVault({ passphrase: 'p', kdf });
    await expect(mergeKeyrings(a, other.keyring, dk)).rejects.toThrow(UnlockError);
  });

  it('ignores a copy of the keyring changed outside the app', async () => {
    const { keyring, dk } = await createVault({ passphrase: 'p', kdf });
    expect(await verifyKeyring(keyring, dk)).toBe(true);
    const lockedOut = { ...keyring, revoked: keyring.wraps.map((w) => w.id) };
    expect(await verifyKeyring(lockedOut, dk)).toBe(false);
    const merged = await mergeKeyrings(keyring, lockedOut, dk);
    expect(merged.rejected).toBe(true);
    expect(merged.keyring).toBe(keyring);
    const reordered = { ...keyring, wraps: [...keyring.wraps].reverse() };
    expect(await verifyKeyring(JSON.parse(JSON.stringify(reordered)), dk)).toBe(true);
  });
});
