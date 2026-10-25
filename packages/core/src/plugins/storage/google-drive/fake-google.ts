// SPDX-License-Identifier: AGPL-3.0-only
// An in-memory stand-in for Google, for tests: the sign-in page, the token endpoint and the parts
// of the Drive API that drive.ts uses. Like Google, it checks the client secret, PKCE and access
// tokens, and pages its listings.
import { DRIVE_API, DRIVE_UPLOAD } from './drive.ts';
import { DRIVE_SCOPE, pkceChallenge } from './oauth.ts';
import { GOOGLE_TOKEN_URL } from './token-server.ts';

const FOLDER = 'application/vnd.google-apps.folder';

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  bytes: Uint8Array;
  created: string;
  modified: string;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, reason: string) =>
  json({ error: { code: status, status: reason, errors: [{ reason }] } }, status);
const binary = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');
const bytesOf = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const unquote = (text: string) => text.replaceAll("\\'", "'").replaceAll('\\\\', '\\');

/** The metadata and content of a multipart/related upload. */
function multipart(body: Uint8Array, type: string): { meta: Partial<FakeFile>; bytes: Uint8Array } {
  const boundary = /boundary=([^;]+)/.exec(type)?.[1] ?? '';
  const [, metaPart = '', dataPart = ''] = binary(body).split(`--${boundary}`);
  const content = (part: string) => part.slice(part.indexOf('\r\n\r\n') + 4, -2);

  return {
    meta: JSON.parse(new TextDecoder().decode(bytesOf(content(metaPart)))) as Partial<FakeFile>,
    bytes: bytesOf(content(dataPart)),
  };
}

export function fakeGoogle(
  options: { clientId?: string; clientSecret?: string; pageSize?: number; email?: string } = {},
) {
  const clientId = options.clientId ?? 'arthly-test.apps.googleusercontent.com';
  const clientSecret = options.clientSecret ?? 'test-secret';
  const files = new Map<string, FakeFile>();
  const codes = new Map<string, { challenge: string; redirectUri: string; scope: string }>();
  const refreshTokens = new Set<string>();
  const accessTokens = new Set<string>();
  let counter = 0;
  const next = (prefix: string) => `${prefix}${++counter}`;
  // Each change is a second later than the last, so ordering by time is reliable.
  const stamp = () => new Date(Date.UTC(2026, 9, 24) + ++counter * 1000).toISOString();

  const state = {
    offline: false,
    /** False: the user left the Drive box unticked on the consent screen. */
    grantScope: true,
    /** Every request, as "METHOD url". */
    requests: [] as string[],
    /** Access tokens stop working, as an hour later. */
    expireAccess: () => accessTokens.clear(),
    /** The user removed the app's access in their Google account. */
    revoke: () => {
      refreshTokens.clear();
      accessTokens.clear();
    },
  };

  /** Where Google's sign-in page sends the browser once the user agrees. */
  function authorize(address: string): string {
    const q = new URL(address).searchParams;

    if (q.get('client_id') !== clientId || q.get('code_challenge_method') !== 'S256') {
      throw new Error('The sign-in page was asked wrongly');
    }

    const code = next('code-');
    const back = new URL(q.get('redirect_uri')!);

    codes.set(code, {
      challenge: q.get('code_challenge')!,
      redirectUri: back.href,
      scope: state.grantScope ? q.get('scope')! : 'openid',
    });
    back.searchParams.set('code', code);
    back.searchParams.set('state', q.get('state')!);

    return back.href;
  }

  function issue(scope: string, refresh?: string) {
    const access = next('access-');

    accessTokens.add(access);

    return json({
      access_token: access,
      expires_in: 3599,
      scope,
      token_type: 'Bearer',
      ...(refresh ? { refresh_token: refresh } : {}),
    });
  }

  function token(form: URLSearchParams): Response {
    if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) {
      return json({ error: 'invalid_client' }, 401);
    }

    if (form.get('grant_type') === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '');

      codes.delete(form.get('code') ?? '');

      if (
        !code ||
        code.redirectUri !== form.get('redirect_uri') ||
        pkceChallenge(form.get('code_verifier') ?? '') !== code.challenge
      ) {
        return json({ error: 'invalid_grant' }, 400);
      }

      const refresh = next('refresh-');

      refreshTokens.add(refresh);

      return issue(code.scope, refresh);
    }

    if (form.get('grant_type') === 'refresh_token') {
      return refreshTokens.has(form.get('refresh_token') ?? '')
        ? issue(DRIVE_SCOPE)
        : json({ error: 'invalid_grant' }, 400);
    }

    return json({ error: 'unsupported_grant_type' }, 400);
  }

  function listing(url: URL): Response {
    const q = url.searchParams.get('q') ?? '';
    const parent = /'((?:[^'\\]|\\.)*)' in parents/.exec(q)?.[1];
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
    const found = [...files.values()].filter(
      (f) =>
        (!q.includes(`mimeType = '${FOLDER}'`) || f.mimeType === FOLDER) &&
        (parent === undefined || f.parents.includes(unquote(parent))) &&
        (name === undefined || f.name === unquote(name)),
    );
    const size = Math.min(Number(url.searchParams.get('pageSize')), options.pageSize ?? 1000);
    const from = Number(url.searchParams.get('pageToken') ?? 0);
    const page = found.slice(from, from + size);

    return json({
      files: page.map((f) => ({
        id: f.id,
        name: f.name,
        ...(f.mimeType === FOLDER ? {} : { size: String(f.bytes.length) }),
        parents: f.parents,
        createdTime: f.created,
        modifiedTime: f.modified,
      })),
      ...(from + size < found.length ? { nextPageToken: String(from + size) } : {}),
    });
  }

  function add(meta: Partial<FakeFile>, bytes: Uint8Array = new Uint8Array()): Response {
    const when = stamp();
    const file: FakeFile = {
      id: next('file-'),
      name: meta.name ?? 'Untitled',
      mimeType: meta.mimeType ?? 'application/octet-stream',
      parents: (meta.parents ?? ['root']).map((p) => (p === 'root' ? 'my-drive' : p)),
      bytes,
      created: when,
      modified: when,
    };

    files.set(file.id, file);

    return json({ id: file.id });
  }

  async function drive(request: Request, url: URL): Promise<Response> {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';

    if (!accessTokens.has(token)) {
      return problem(401, 'authError');
    }

    const path = url.href.startsWith(DRIVE_UPLOAD)
      ? url.pathname.replace('/upload/drive/v3', '')
      : url.pathname.replace('/drive/v3', '');
    const fileId = /^\/files\/([^/]+)$/.exec(path)?.[1];
    const file = fileId ? files.get(fileId) : undefined;

    if (path === '/about') {
      return json({ user: { emailAddress: options.email ?? 'asha@example.com' } });
    }

    if (path === '/files' && request.method === 'GET') {
      return listing(url);
    }

    if (path === '/files' && request.method === 'POST') {
      const type = request.headers.get('content-type') ?? '';
      const body = new Uint8Array(await request.arrayBuffer());

      if (url.searchParams.get('uploadType') === 'multipart') {
        const { meta, bytes } = multipart(body, type);

        return add(meta, bytes);
      }

      return add(JSON.parse(new TextDecoder().decode(body)) as Partial<FakeFile>);
    }

    if (!file) {
      return problem(404, 'notFound');
    }

    if (request.method === 'GET' && url.searchParams.get('alt') === 'media') {
      return new Response(new Uint8Array(file.bytes));
    }

    if (request.method === 'PATCH') {
      file.bytes = new Uint8Array(await request.arrayBuffer());
      file.modified = stamp();

      return json({ id: file.id });
    }

    if (request.method === 'DELETE') {
      files.delete(file.id);

      return new Response(null, { status: 204 });
    }

    return problem(400, 'badRequest');
  }

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);

    if (state.offline) {
      throw new TypeError('Failed to fetch');
    }

    state.requests.push(`${request.method} ${request.url}`);
    const url = new URL(request.url);

    if (request.url === GOOGLE_TOKEN_URL) {
      return token(new URLSearchParams(await request.text()));
    }

    if (url.href.startsWith(DRIVE_API) || url.href.startsWith(DRIVE_UPLOAD)) {
      return drive(request, url);
    }

    return new Response('Not found', { status: 404 });
  }) as typeof globalThis.fetch;

  /** The files in a folder, by name. */
  const folder = (folderId: string) =>
    new Map(
      [...files.values()].filter((f) => f.parents.includes(folderId)).map((f) => [f.name, f]),
    );

  return { fetch, authorize, files, folder, state, clientId, clientSecret };
}

export type FakeGoogle = ReturnType<typeof fakeGoogle>;
