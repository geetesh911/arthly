// SPDX-License-Identifier: AGPL-3.0-only
import { googleAuthUrl, type GoogleGrant, type LocalStore, MemoryLocalStore, pkce } from '@pv/core';
import { type FakeGoogle, fakeGoogle } from '@pv/core/plugins/storage/google-drive/fake-google.ts';
import { googleToken } from '@pv/core/plugins/storage/google-drive/token-server.ts';
import { describe, expect, it } from 'vitest';

import { IN_USE } from './dto.ts';
import { DataService } from './service.ts';
import type { DeviceStorage, VaultEntry } from './storage.ts';

const APP = 'https://app.test';
const PASSPHRASE = 'correct horse';

function memoryStorage(): DeviceStorage {
  const entries = new Map<string, VaultEntry>();
  const stores = new Map<string, LocalStore>();

  return {
    vaults: async () => [...entries.values()],
    addVault: async (e) => void entries.set(e.vaultId, e),
    removeVault: async (id) => void entries.delete(id),
    async open(id) {
      if (!stores.has(id)) {
        stores.set(id, new MemoryLocalStore());
      }

      return stores.get(id)!;
    },
  };
}

/** The app's token function and Google, as the data worker reaches them; prices are offline. */
function network(google: FakeGoogle): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.origin !== APP) {
      return google.fetch(request);
    }

    if (!url.pathname.startsWith('/api/google/')) {
      return new Response('offline', { status: 503 });
    }

    // The browser adds Origin to the worker's POST.
    const headers = new Headers(request.headers);

    headers.set('origin', APP);

    return googleToken(url.pathname.split('/').at(-1)!, new Request(request, { headers }), {
      fetch: google.fetch,
      clientId: google.clientId,
      clientSecret: google.clientSecret,
    });
  }) as typeof fetch;
}

/** What the screens hand the worker after Google's sign-in page. */
function signIn(google: FakeGoogle): GoogleGrant {
  const { verifier, challenge, state } = pkce();
  const redirectUri = `${APP}/oauth.html`;
  const back = new URL(
    google.authorize(googleAuthUrl({ clientId: google.clientId, redirectUri, state, challenge })),
  );

  return { code: back.searchParams.get('code')!, verifier, redirectUri };
}

function device(
  google: FakeGoogle,
  {
    storage = memoryStorage(),
    locks,
    fetch = network(google),
  }: {
    storage?: DeviceStorage;
    locks?: LockManager;
    fetch?: typeof globalThis.fetch;
  } = {},
) {
  return new DataService(storage, {
    fetch,
    relayUrl: `${APP}/api/prices/`,
    now: () => new Date('2026-10-24T10:00:00+05:30'),
    kdf: { alg: 'argon2id', m: 256, t: 1, p: 1 },
    autoSync: false,
    ...(locks ? { locks } : {}),
  });
}

/** The network, with Drive requests that hang while `hang.on` until they're aborted. */
function hanging(google: FakeGoogle) {
  const hang = { on: false, aborted: 0 };
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!hang.on || !new Request(input).url.startsWith('https://www.googleapis.com/')) {
      return network(google)(input, init);
    }

    return new Promise((_, reject) =>
      init?.signal?.addEventListener('abort', () => {
        hang.aborted += 1;
        reject(new DOMException('Aborted', 'AbortError'));
      }),
    );
  }) as typeof globalThis.fetch;

  return { hang, fetch };
}

/** Web Locks with just what the app asks for: ifAvailable and steal. */
function fakeLocks(): LockManager {
  const held = new Map<string, (error: unknown) => void>();

  return {
    async request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) {
      if (held.has(name) && options.ifAvailable) {
        return callback(null);
      }

      if (held.has(name) && options.steal) {
        held.get(name)!(new DOMException('Taken by another tab', 'AbortError'));
        held.delete(name);
      }

      return new Promise((resolve, reject) => {
        held.set(name, reject);
        void Promise.resolve(callback({ name, mode: 'exclusive' })).then((value) => {
          if (held.get(name) === reject) {
            held.delete(name);
          }

          resolve(value);
        });
      });
    },
  } as unknown as LockManager;
}

async function connected() {
  const google = fakeGoogle();
  const laptop = device(google);
  const { vaultId } = await laptop.create('Family', 'Asha', PASSPHRASE);

  await laptop.connectGoogle(signIn(google));

  return { google, laptop, vaultId };
}

describe('cloud sync', () => {
  it('connects to Google Drive, opens on a second device and carries changes both ways', async () => {
    const google = fakeGoogle();
    const laptop = device(google);
    const { vaultId } = await laptop.create('Family', 'Asha', PASSPHRASE);

    expect(laptop.cloudStatus()).toEqual({ available: true, syncing: false, problems: 0 });
    // With something to lose and no backup, the checks ask for a backup or sync.
    await laptop.addLoan({
      memberId: laptop.list('member')[0]!.id,
      direction: 'lent',
      party: 'Sample friend',
      amount: 5000,
      date: '2026-10-01',
    });
    expect((await laptop.checks()).map((c) => c.type)).toContain('backup.none');
    const status = await laptop.connectGoogle(signIn(google));

    expect(status).toMatchObject({
      provider: 'google-drive',
      account: 'asha@example.com',
      syncing: false,
    });
    expect(status.lastSync).toBe('2026-10-24T04:30:00.000Z');
    expect((await laptop.checks()).map((c) => c.type)).not.toContain('backup.none');
    const folder = [...google.files.values()].find((f) => f.name === vaultId)!;

    expect([...google.folder(folder.id).keys()].sort()).toEqual([
      'keyring.json',
      expect.stringMatching(/^log\/[a-z2-7]{8}\/00000001\.pvc$/),
    ]);

    const phone = device(google);
    const found = await phone.googlePortfolios(signIn(google));

    expect(found).toEqual([{ vaultId, created: expect.any(String), onDevice: false }]);
    await expect(
      phone.openFromCloud(vaultId, { passphrase: 'wrong one' }, 'Family'),
    ).rejects.toThrow();
    expect(await phone.vaults()).toEqual([]);
    await phone.openFromCloud(vaultId, { passphrase: PASSPHRASE }, 'Our family');
    expect(phone.current()).toMatchObject({ vaultId, name: 'Our family' });
    expect(phone.list('member').map((m) => m.name)).toEqual(['Asha']);
    expect(phone.cloudStatus()).toMatchObject({ provider: 'google-drive', problems: 0 });

    const heard: boolean[] = [];

    laptop.onSync = (_, pulled) => heard.push(pulled);
    await phone.save('member', { id: 'mem_ravi', name: 'Ravi' });
    await phone.syncNow();
    await laptop.syncNow();
    expect(
      laptop
        .list('member')
        .map((m) => m.name)
        .sort(),
    ).toEqual(['Asha', 'Ravi']);
    expect(heard).toEqual([false, true]);
    expect((await phone.googlePortfolios(signIn(google)))[0]?.onDevice).toBe(true);
    // Losing the connection partway says so, instead of finding nothing.
    const offline = device(google, {
      fetch: (input, init) =>
        new Request(input).url.includes('alt=media')
          ? Promise.reject(new TypeError('Failed to fetch'))
          : network(google)(input, init),
    });

    await expect(offline.googlePortfolios(signIn(google))).rejects.toThrow(/could not be reached/);
    await expect(phone.openFromCloud(vaultId, { passphrase: PASSPHRASE }, 'x')).rejects.toThrow(
      /already on this device/,
    );
    // Locking drops a sign-in made to open a portfolio.
    phone.lock();
    await expect(phone.openFromCloud(vaultId, { passphrase: PASSPHRASE }, 'x')).rejects.toThrow(
      /Sign in to Google first/,
    );
  });

  it('keeps the sign-in sealed on the device, out of backups, across unlocks', async () => {
    const { google, laptop, vaultId } = await connected();
    const backup = new TextDecoder().decode((await laptop.backup()).bytes);

    expect(backup).not.toMatch(/refresh-|access-/);
    laptop.lock();
    await laptop.unlock(vaultId, { passphrase: PASSPHRASE });
    google.state.expireAccess();
    await laptop.save('member', { id: 'mem_ravi', name: 'Ravi' });
    const status = await laptop.syncNow();

    expect(status).toMatchObject({ provider: 'google-drive' });
    expect(status.error ?? status.reconnect ?? status.retrying).toBeUndefined();
  });

  it('retries when offline, asks to reconnect when access is removed, and disconnects', async () => {
    const { google, laptop } = await connected();

    google.state.offline = true;
    expect(await laptop.syncNow()).toMatchObject({ retrying: true });
    google.state.offline = false;
    expect((await laptop.syncNow()).retrying).toBeUndefined();

    google.state.revoke();
    expect(await laptop.syncNow()).toMatchObject({ reconnect: true });
    expect((await laptop.connectGoogle(signIn(google))).reconnect).toBeUndefined();

    const files = google.files.size;

    await laptop.disconnectCloud();
    expect(laptop.cloudStatus()).toEqual({ available: true, syncing: false, problems: 0 });
    expect(google.files.size).toBe(files);
  });

  it('refuses a sign-in without the Drive box ticked', async () => {
    const google = fakeGoogle();
    const laptop = device(google);

    await laptop.create('Family', 'Asha', PASSPHRASE);
    google.state.grantScope = false;
    await expect(laptop.connectGoogle(signIn(google))).rejects.toThrow(/tick the box/);
    expect(laptop.cloudStatus().provider).toBeUndefined();
  });

  it('never syncs sample data', async () => {
    const google = fakeGoogle();
    const s = device(google);

    await s.demo();
    expect(s.cloudStatus()).toEqual({ available: false, syncing: false, problems: 0 });
    await expect(s.connectGoogle(signIn(google))).rejects.toThrow(/doesn’t sync/);
  });
});

describe('one tab at a time', () => {
  it('refuses a second tab until it takes over, and locks the first', async () => {
    const google = fakeGoogle();
    const storage = memoryStorage();
    const locks = fakeLocks();
    const first = device(google, { storage, locks });
    const second = device(google, { storage, locks });
    const { vaultId } = await first.create('Family', 'Asha', PASSPHRASE);
    let reason: string | undefined;

    first.onLock = (why) => (reason = why);
    await expect(second.unlock(vaultId, { passphrase: PASSPHRASE })).rejects.toThrow(IN_USE);
    await second.unlock(vaultId, { passphrase: PASSPHRASE }, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.isUnlocked()).toBe(false);
    expect(reason).toMatch(/opened in another tab/);
    expect(second.isUnlocked()).toBe(true);
    // Locking lets the other tab have it again.
    second.lock();
    await first.unlock(vaultId, { passphrase: PASSPHRASE });
    expect(first.isUnlocked()).toBe(true);
  });

  it('stops a sync pass when it locks, and frees the portfolio once the pass has ended', async () => {
    const google = fakeGoogle();
    const storage = memoryStorage();
    const locks = fakeLocks();
    const { hang, fetch } = hanging(google);
    const first = device(google, { storage, locks, fetch });
    const second = device(google, { storage, locks });
    const { vaultId } = await first.create('Family', 'Asha', PASSPHRASE);

    await first.connectGoogle(signIn(google));
    hang.on = true;
    const pass = first.syncNow();

    await new Promise((resolve) => setTimeout(resolve, 0));
    first.lock();
    expect(await pass).toMatchObject({ retrying: true });
    expect(hang.aborted).toBe(1);
    await second.unlock(vaultId, { passphrase: PASSPHRASE });
    expect(second.isUnlocked()).toBe(true);
    // The same tab opens it again straight away, too.
    second.lock();
    hang.on = false;
    await first.unlock(vaultId, { passphrase: PASSPHRASE });
    expect(first.isUnlocked()).toBe(true);
  });
});
