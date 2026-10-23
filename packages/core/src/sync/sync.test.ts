// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addPasskey, createVault, type Keyring, verifyKeyring } from '../crypto/keyring.ts';
import { type Event, putEvent } from '../log/events.ts';
import { all, replay } from '../log/replay.ts';
import { randomBytes, utf8 } from '../util/bytes.ts';

import { makeBackup, readBackup, restoreBackup } from './backup.ts';
import { MemoryLocalStore, MemoryProvider, OfflineError } from './stores.ts';
import { SyncError, VaultLog } from './vault-log.ts';

const kdf = { alg: 'argon2id' as const, m: 256, t: 1, p: 1 };

async function vault() {
  const { keyring, dk } = await createVault({ passphrase: 'p', kdf });

  return { keyring, dk, remote: new MemoryProvider() };
}

async function device(v: { keyring: Keyring; dk: CryptoKey }) {
  const local = new MemoryLocalStore();
  const log = await VaultLog.open(local, v.dk, v.keyring);

  return { local, log };
}

let counter = 0;

function memberEvent(log: VaultLog, name = `m${counter++}`): Event {
  return putEvent(log.clock.next(), 'member', { id: `mem_${name}`, name });
}

const hlcs = (log: VaultLog) =>
  log
    .events()
    .map((e) => e.hlc)
    .sort();

describe('sync', () => {
  it('brings two devices to the same events', async () => {
    const v = await vault();
    const a = await device(v);
    const b = await device(v);

    await a.log.append([memberEvent(a.log), memberEvent(a.log)]);
    expect((await a.log.sync(v.remote)).pushed).toBe(1);
    expect((await b.log.sync(v.remote)).pulled).toBe(2);
    await b.log.append([memberEvent(b.log)]);
    await b.log.sync(v.remote);
    await a.log.sync(v.remote);
    expect(hlcs(a.log)).toEqual(hlcs(b.log));
    expect(hlcs(a.log)).toHaveLength(3);
    expect(v.remote.files.has('keyring.json')).toBe(true);
  });

  it('keeps events on the device across restarts', async () => {
    const v = await vault();
    const a = await device(v);

    await a.log.append([memberEvent(a.log)]);
    await a.log.sync(v.remote);
    await a.log.append([memberEvent(a.log)]);
    const reopened = await VaultLog.open(a.local, v.dk, v.keyring);

    expect(hlcs(reopened)).toEqual(hlcs(a.log));
    expect(reopened.deviceId).toBe(a.log.deviceId);
    const next = memberEvent(reopened);

    expect(next.hlc > hlcs(a.log).at(-1)!).toBe(true);
  });

  it('throws when offline and catches up later', async () => {
    const v = await vault();
    const a = await device(v);
    const b = await device(v);

    await a.log.append([memberEvent(a.log)]);
    v.remote.offline = true;
    await expect(a.log.sync(v.remote)).rejects.toThrow(OfflineError);
    v.remote.offline = false;
    await a.log.sync(v.remote);
    await b.log.sync(v.remote);
    expect(hlcs(b.log)).toEqual(hlcs(a.log));
  });

  it('skips and reports a chunk that fails to decrypt', async () => {
    const v = await vault();
    const a = await device(v);
    const b = await device(v);

    await a.log.append([memberEvent(a.log)]);
    await a.log.sync(v.remote);
    await a.log.append([memberEvent(a.log)]);
    await a.log.sync(v.remote);
    const [first] = [...v.remote.files.keys()].filter((p) => p.startsWith('log/')).sort();
    const bytes = v.remote.files.get(first!)!;

    bytes[bytes.length - 1]! ^= 1;
    const report = await b.log.sync(v.remote);

    expect(report.problems).toEqual([first]);
    expect(b.log.events()).toHaveLength(1);
    expect(b.log.problems).toEqual([first]);
  });

  it('refuses a remote folder that belongs to another vault', async () => {
    const v = await vault();
    const other = await vault();
    const a = await device(v);

    await (await device(other)).log.sync(v.remote);
    await expect(a.log.sync(v.remote)).rejects.toThrow(SyncError);
  });

  it('merges keyring changes and ignores a tampered remote keyring', async () => {
    const v = await vault();
    const a = await device(v);
    const b = await device(v);

    await a.log.sync(v.remote);
    const withPasskey = await addPasskey(a.log.keyring, v.dk, {
      credentialId: 'c',
      prfSalt: 's',
      prfOutput: randomBytes(32),
      label: 'Phone',
    });

    await a.log.setKeyring(withPasskey);
    await a.log.sync(v.remote);
    expect((await b.log.sync(v.remote)).keyringChanged).toBe(true);
    expect(b.log.keyring.wraps).toHaveLength(3);

    const remote = JSON.parse(utf8.decode(v.remote.files.get('keyring.json')!)) as Keyring;

    remote.revoked = remote.wraps.map((w) => w.id);
    v.remote.files.set('keyring.json', utf8.encode(JSON.stringify(remote)));
    const report = await b.log.sync(v.remote);

    expect(report.keyringRejected).toBe(true);
    expect(b.log.keyring.revoked).toEqual([]);
    const repaired = JSON.parse(utf8.decode(v.remote.files.get('keyring.json')!)) as Keyring;

    expect(await verifyKeyring(repaired, v.dk)).toBe(true);
  });

  it('compacts into a snap that a new device can start from', async () => {
    const v = await vault();
    const a = await device(v);
    const b = await device(v);

    for (let i = 0; i < 4; i++) {
      await a.log.append([memberEvent(a.log)]);
      await a.log.sync(v.remote, { compactAfter: 3 });
      await b.log.append([memberEvent(b.log)]);
      await b.log.sync(v.remote, { compactAfter: 3 });
    }

    const snaps = [...v.remote.files.keys()].filter((p) => p.startsWith('snap/'));

    expect(snaps.length).toBeGreaterThan(0);
    await a.log.sync(v.remote, { compactAfter: 3 });
    const fresh = await device(v);

    await fresh.log.sync(v.remote, { compactAfter: 3 });
    await b.log.sync(v.remote, { compactAfter: 3 });
    expect(hlcs(fresh.log)).toEqual(hlcs(b.log));
    expect(hlcs(fresh.log)).toHaveLength(8);
  });

  it('converges for any mix of saves, syncs, outages and compaction', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            device: fc.integer({ min: 0, max: 2 }),
            action: fc.constantFrom('save', 'save', 'sync', 'offline-sync'),
            count: fc.integer({ min: 1, max: 3 }),
          }),
          { maxLength: 25 },
        ),
        async (steps) => {
          const v = await vault();
          const devices = [await device(v), await device(v), await device(v)];

          for (const step of steps) {
            const { log } = devices[step.device]!;

            if (step.action === 'save') {
              await log.append(Array.from({ length: step.count }, () => memberEvent(log)));
            } else {
              v.remote.offline = step.action === 'offline-sync';
              await log.sync(v.remote, { compactAfter: 4 }).catch((e: unknown) => {
                if (!(e instanceof OfflineError)) {
                  throw e;
                }
              });
              v.remote.offline = false;
            }
          }

          for (let round = 0; round < 2; round++) {
            for (const d of devices) {
              await d.log.sync(v.remote, { compactAfter: 4 });
            }
          }

          const late = await device(v);

          await late.log.sync(v.remote, { compactAfter: 4 });
          const expected = hlcs(devices[0]!.log);
          const saved = steps.filter((s) => s.action === 'save').reduce((n, s) => n + s.count, 0);

          expect(expected).toHaveLength(saved);

          for (const d of [...devices, late]) {
            expect(hlcs(d.log)).toEqual(expected);
            expect(all(replay(d.log.events()), 'member')).toHaveLength(saved);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('backup file', () => {
  it('restores on a new device, which takes over unsynced events', async () => {
    const v = await vault();
    const a = await device(v);

    await a.log.append([memberEvent(a.log)]);
    await a.log.sync(v.remote);
    await a.log.append([memberEvent(a.log), memberEvent(a.log)]);

    const file = readBackup(await makeBackup(a.log, a.local));
    const restoredLocal = new MemoryLocalStore();
    const restored = await restoreBackup(file, restoredLocal, v.dk);

    expect(hlcs(restored)).toEqual(hlcs(a.log));
    expect(restored.deviceId).not.toBe(a.log.deviceId);

    await restored.sync(v.remote);
    const c = await device(v);

    await c.log.sync(v.remote);
    expect(hlcs(c.log)).toEqual(hlcs(a.log));
  });

  it('rejects files that are not backups', () => {
    expect(() => readBackup(utf8.encode('hello'))).toThrow('not a backup');
    expect(() => readBackup(utf8.encode('{"format":"x"}'))).toThrow('not a backup');
  });
});
