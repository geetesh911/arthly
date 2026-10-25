// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { createVault } from '../../../crypto/keyring.ts';
import { putEvent } from '../../../log/events.ts';
import { MemoryLocalStore, OfflineError } from '../../../sync/stores.ts';
import { VaultLog } from '../../../sync/vault-log.ts';
import { utf8 } from '../../../util/bytes.ts';

import { DriveError, GoogleDrive, ReconnectError, ROOT_FOLDER } from './drive.ts';
import { type FakeGoogle, fakeGoogle } from './fake-google.ts';
import { DRIVE_SCOPE, googleAuthUrl, pkce } from './oauth.ts';
import { GoogleSession, GoogleTokens } from './session.ts';
import { googleToken } from './token-server.ts';

const APP = 'https://app.test';
const REDIRECT = `${APP}/oauth.html`;

/** The app's token function, run against the fake Google, as the data worker reaches it. */
function tokenFunction(google: FakeGoogle, env: { clientId?: string } = {}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);

    // A browser adds Origin to every POST.
    if (request.method === 'POST' && !headers.has('origin')) {
      headers.set('origin', APP);
    }

    return googleToken(
      new URL(request.url).pathname.split('/').at(-1)!,
      new Request(request, { headers }),
      {
        fetch: google.fetch,
        clientId: 'clientId' in env ? env.clientId : google.clientId,
        clientSecret: google.clientSecret,
      },
    );
  }) as typeof fetch;
}

/** Signs in as the screens and the worker would: Google's page, then the token function. */
async function signIn(google: FakeGoogle, now = () => Date.now()) {
  const { verifier, challenge, state } = pkce();
  const back = new URL(
    google.authorize(
      googleAuthUrl({ clientId: google.clientId, redirectUri: REDIRECT, state, challenge }),
    ),
  );

  expect(back.searchParams.get('state')).toBe(state);
  const tokens = new GoogleTokens(tokenFunction(google), `${APP}/api/google/token`);
  const session = await GoogleSession.start(
    tokens,
    { code: back.searchParams.get('code')!, verifier, redirectUri: REDIRECT },
    now,
  );

  return { session, drive: new GoogleDrive(google.fetch, session) };
}

const post = (body: unknown, origin = APP) =>
  new Request(`${APP}/api/google/token`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('token function', () => {
  it('gives the client ID, or says Google Drive is not set up', async () => {
    const google = fakeGoogle();
    const env = { fetch: google.fetch, clientId: google.clientId, clientSecret: 'x' };
    const config = await googleToken('config', new Request(`${APP}/api/google/config`), env);

    expect(await config.json()).toEqual({ clientId: google.clientId });
    expect(config.headers.get('cache-control')).toBe('no-store');
    const missing = await googleToken('config', new Request(`${APP}/api/google/config`), {
      fetch: google.fetch,
    });

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_configured' });
    expect((await googleToken('other', new Request(`${APP}/api/google/other`), env)).status).toBe(
      404,
    );
  });

  it('swaps a code for tokens with the client secret, passing on only the tokens', async () => {
    const google = fakeGoogle();
    const { verifier, challenge, state } = pkce();
    const back = new URL(
      google.authorize(
        googleAuthUrl({ clientId: google.clientId, redirectUri: REDIRECT, state, challenge }),
      ),
    );
    const env = {
      fetch: google.fetch,
      clientId: google.clientId,
      clientSecret: google.clientSecret,
    };
    const res = await googleToken(
      'token',
      post({
        grant_type: 'authorization_code',
        code: back.searchParams.get('code'),
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      }),
      env,
    );
    const answer = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(Object.keys(answer).sort()).toEqual([
      'access_token',
      'expires_in',
      'refresh_token',
      'scope',
      'token_type',
    ]);
    expect(answer.scope).toBe(DRIVE_SCOPE);
    const refreshed = await googleToken(
      'token',
      post({ grant_type: 'refresh_token', refresh_token: answer.refresh_token }),
      env,
    );

    expect(((await refreshed.json()) as { access_token: string }).access_token).toMatch(/^access-/);
  });

  it('turns away other sites, other redirect pages and malformed asks', async () => {
    const google = fakeGoogle();
    const env = {
      fetch: google.fetch,
      clientId: google.clientId,
      clientSecret: google.clientSecret,
    };
    const code = { grant_type: 'authorization_code', code: 'c', code_verifier: 'v' };

    expect(
      (
        await googleToken(
          'token',
          post({ ...code, redirect_uri: REDIRECT }, 'https://evil.test'),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await googleToken(
          'token',
          post({ ...code, redirect_uri: 'https://evil.test/oauth.html' }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (await googleToken('token', post({ ...code, redirect_uri: `${APP}/elsewhere` }), env)).status,
    ).toBe(400);
    expect((await googleToken('token', post({ grant_type: 'password' }), env)).status).toBe(400);

    for (const body of [null, 'refresh_token', ['refresh_token']]) {
      expect((await googleToken('token', post(body), env)).status).toBe(400);
    }

    expect((await googleToken('token', new Request(`${APP}/api/google/token`), env)).status).toBe(
      405,
    );
    expect(google.state.requests).toEqual([]);
  });

  it("passes on Google's refusal, and says when Google can't be reached", async () => {
    const google = fakeGoogle();
    const env = {
      fetch: google.fetch,
      clientId: google.clientId,
      clientSecret: google.clientSecret,
    };
    const refused = await googleToken(
      'token',
      post({ grant_type: 'refresh_token', refresh_token: 'refresh-unknown' }),
      env,
    );

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'invalid_grant' });
    google.state.offline = true;
    const down = await googleToken(
      'token',
      post({ grant_type: 'refresh_token', refresh_token: 'refresh-1' }),
      env,
    );

    expect(down.status).toBe(502);
  });
});

describe('Google sign-in', () => {
  it('keeps an access token until it nearly expires, then refreshes it', async () => {
    const google = fakeGoogle();
    let now = 0;
    const { session } = await signIn(google, () => now);
    const first = await session.token();

    expect(await session.token()).toBe(first);
    now += 3540_000;
    expect(await session.token()).not.toBe(first);
  });

  it('refuses a sign-in that left the Drive box unticked', async () => {
    const google = fakeGoogle();

    google.state.grantScope = false;
    await expect(signIn(google)).rejects.toThrow(/tick the box for Google Drive/);
  });

  it('asks to reconnect once Google access is removed', async () => {
    const google = fakeGoogle();
    const { session } = await signIn(google);

    google.state.revoke();
    await expect(session.token(true)).rejects.toBeInstanceOf(ReconnectError);
  });

  it('says when the token function is missing', async () => {
    const google = fakeGoogle();
    const tokens = new GoogleTokens(
      tokenFunction(google, { clientId: undefined }),
      `${APP}/x/token`,
    );

    await expect(tokens.refresh('r')).rejects.toThrow(/isn’t set up/);
  });
});

describe('Google Drive provider', () => {
  it('makes the Arthly folder and a folder per vault, and finds them again', async () => {
    const google = fakeGoogle();
    const { drive } = await signIn(google);

    expect(await drive.vaults()).toEqual([]);
    expect(await drive.vaultFolder('vault_aaaa', false)).toBeUndefined();
    expect(await drive.rootFolder(false)).toBeUndefined();
    const a = await drive.vaultFolder('vault_aaaa', true);
    const b = await drive.vaultFolder('vault_bbbb', true);

    expect(await drive.vaultFolder('vault_aaaa', true)).toBe(a);
    const roots = [...google.files.values()].filter((f) => f.name === ROOT_FOLDER);

    expect(roots).toHaveLength(1);
    expect(await drive.rootFolder(true)).toBe(roots[0]!.id);
    expect(await (await signIn(fakeGoogle())).drive.rootFolder(true)).toEqual(expect.any(String));
    expect((await drive.vaults()).sort((x, y) => x.vaultId.localeCompare(y.vaultId))).toEqual([
      { vaultId: 'vault_aaaa', folderId: a },
      { vaultId: 'vault_bbbb', folderId: b },
    ]);
    expect(await drive.account()).toBe('asha@example.com');
  });

  it('writes, lists, reads, overwrites and removes files, across pages', async () => {
    const google = fakeGoogle({ pageSize: 2 });
    const { drive } = await signIn(google);
    const folder = drive.folder((await drive.vaultFolder('vault_aaaa', true))!);
    const bytes = new Uint8Array([0, 13, 10, 45, 45, 255, 128]);

    for (const path of ['keyring.json', 'log/abcd/00000001.pvc', 'log/abcd/00000002.pvc']) {
      await folder.write(path, path.endsWith('.json') ? utf8.encode('{"v":1}') : bytes);
    }

    expect((await folder.list('')).map((f) => f.path).sort()).toEqual([
      'keyring.json',
      'log/abcd/00000001.pvc',
      'log/abcd/00000002.pvc',
    ]);
    expect((await folder.list('log/')).sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: 'log/abcd/00000001.pvc', size: 7 },
      { path: 'log/abcd/00000002.pvc', size: 7 },
    ]);
    expect(await folder.read('log/abcd/00000002.pvc')).toEqual(bytes);
    expect((await folder.listFiles('log/')).map((f) => [f.name, f.modified])).toEqual([
      ['log/abcd/00000002.pvc', expect.stringMatching(/^2026-/)],
      ['log/abcd/00000001.pvc', expect.stringMatching(/^2026-/)],
    ]);
    await folder.write('keyring.json', utf8.encode('{"v":2}'));
    expect(utf8.decode(await folder.read('keyring.json'))).toBe('{"v":2}');
    expect(google.state.requests.filter((r) => r.startsWith('PATCH'))).toHaveLength(1);
    await folder.remove('log/abcd/00000001.pvc');
    await folder.remove('log/abcd/00000001.pvc');
    expect((await folder.list('log/')).map((f) => f.path)).toEqual(['log/abcd/00000002.pvc']);
    // A fresh provider for the same folder finds files by name before any listing.
    expect(await drive.folder(folder.folderId).read('log/abcd/00000002.pvc')).toEqual(bytes);
    await expect(drive.folder(folder.folderId).read('snap/none.pvc')).rejects.toBeInstanceOf(
      DriveError,
    );
  });

  it('reads the newest of two files with one name, and removes both', async () => {
    const google = fakeGoogle();
    const { drive } = await signIn(google);
    const folderId = (await drive.vaultFolder('vault_aaaa', true))!;

    await drive.folder(folderId).write('keyring.json', utf8.encode('old'));
    await drive.folder(folderId).write('keyring.json', utf8.encode('new'));
    const folder = drive.folder(folderId);

    expect(await folder.list('')).toEqual([{ path: 'keyring.json', size: 3 }]);
    expect(utf8.decode(await folder.read('keyring.json'))).toBe('new');
    await folder.remove('keyring.json');
    expect(google.folder(folderId).size).toBe(0);
  });

  it('gets a fresh token once when Drive refuses the last one', async () => {
    const google = fakeGoogle();
    const { drive } = await signIn(google);
    const folderId = (await drive.vaultFolder('vault_aaaa', true))!;

    google.state.expireAccess();
    expect(await drive.folder(folderId).list('')).toEqual([]);
  });

  it('counts a lost connection, a busy Drive or a vanished file as try again later', async () => {
    const google = fakeGoogle();
    const { session } = await signIn(google);
    let answer: Response | undefined;
    const drive = new GoogleDrive(
      (async (input: RequestInfo | URL, init?: RequestInit) =>
        answer ?? google.fetch(input, init)) as typeof fetch,
      session,
    );
    const folderId = (await drive.vaultFolder('vault_aaaa', true))!;
    const folder = drive.folder(folderId);

    await folder.write('log/abcd/00000001.pvc', new Uint8Array([1]));
    await folder.list('');
    google.files.delete([...google.folder(folderId).values()][0]!.id);
    await expect(folder.read('log/abcd/00000001.pvc')).rejects.toBeInstanceOf(OfflineError);
    answer = new Response('', { status: 503 });
    await expect(folder.list('')).rejects.toBeInstanceOf(OfflineError);
    answer = Response.json(
      { error: { errors: [{ reason: 'storageQuotaExceeded' }] } },
      { status: 403 },
    );
    await expect(folder.write('log/abcd/00000002.pvc', new Uint8Array([2]))).rejects.toThrow(
      'Your Google Drive is full',
    );
    answer = undefined;
    google.state.offline = true;
    await expect(folder.list('')).rejects.toBeInstanceOf(OfflineError);
  });

  it('carries two devices’ changes to each other, through a compaction', async () => {
    const google = fakeGoogle();
    const { drive } = await signIn(google);
    const { keyring, dk } = await createVault({
      passphrase: 'p',
      kdf: { alg: 'argon2id', m: 256, t: 1, p: 1 },
    });
    const folderId = (await drive.vaultFolder(keyring.vaultId, true))!;
    const a = await VaultLog.open(new MemoryLocalStore(), dk, keyring);
    const b = await VaultLog.open(new MemoryLocalStore(), dk, keyring);
    const member = (log: VaultLog, name: string) =>
      putEvent(log.clock.next(), 'member', { id: `mem_${name}`, name });

    for (let i = 0; i < 3; i++) {
      await a.append([member(a, `a${i}`)]);
      await a.sync(drive.folder(folderId));
    }

    expect((await b.sync(drive.folder(folderId))).pulled).toBe(3);
    await b.append([member(b, 'b0')]);
    const report = await b.sync(drive.folder(folderId), { compactAfter: 2 });

    expect(report.compacted).toBe(true);
    await a.sync(drive.folder(folderId));
    expect(
      a
        .events()
        .map((e) => e.hlc)
        .sort(),
    ).toEqual(
      b
        .events()
        .map((e) => e.hlc)
        .sort(),
    );
    expect(a.events()).toHaveLength(4);
    // A third device starts from the snap.
    const c = await VaultLog.open(new MemoryLocalStore(), dk, keyring);

    await c.sync(drive.folder(folderId));
    expect(c.events()).toHaveLength(4);
    expect(google.folder(folderId).has('keyring.json')).toBe(true);
  });
});
