// SPDX-License-Identifier: AGPL-3.0-only
// The token function, run as a Cloudflare Pages Function (functions/api/google/[route].ts). Google
// gives refresh tokens to web apps only in exchange for the client secret, which can't ship in the
// app, so this swaps codes and refresh tokens for the app. It sees Google tokens but never any
// data, since everything is encrypted before it goes to Drive, and it keeps nothing.
//
//   GET  /api/google/config  { clientId }, or 404 { error: 'not_configured' }
//   POST /api/google/token   { grant_type: 'authorization_code', code, code_verifier, redirect_uri }
//                            { grant_type: 'refresh_token', refresh_token }
import { CALLBACK_PAGE } from './oauth.ts';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleTokenEnv {
  fetch: typeof fetch;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

const MAX_BODY = 4096;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length < 2048;

function address(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export async function googleToken(
  route: string,
  request: Request,
  env: GoogleTokenEnv,
): Promise<Response> {
  if (route !== 'config' && route !== 'token') {
    return reply({ error: 'not_found' }, 404);
  }

  if (!env.clientId || !env.clientSecret) {
    return reply({ error: 'not_configured' }, 404);
  }

  if (route === 'config') {
    return request.method === 'GET'
      ? reply({ clientId: env.clientId })
      : reply({ error: 'method_not_allowed' }, 405);
  }

  if (request.method !== 'POST') {
    return reply({ error: 'method_not_allowed' }, 405);
  }

  // Browsers always send Origin on a POST, so other sites' pages can't use this.
  const origin = new URL(request.url).origin;

  if (request.headers.get('origin') !== origin) {
    return reply({ error: 'forbidden' }, 403);
  }

  const raw = await request.text();
  let body: Record<string, unknown> = {};

  try {
    const parsed: unknown = raw.length <= MAX_BODY ? JSON.parse(raw) : null;

    // Anything but a JSON object, such as null, is a malformed ask.
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON: a malformed ask too.
  }

  const form = new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret });

  if (body.grant_type === 'authorization_code') {
    const { code, code_verifier: verifier, redirect_uri: redirect } = body;
    const back = text(redirect) ? address(redirect) : null;

    // Only the app's own page can receive codes, so a code meant elsewhere can't be swapped here.
    if (
      !text(code) ||
      !text(verifier) ||
      back?.origin !== origin ||
      !back.pathname.endsWith(`/${CALLBACK_PAGE}`)
    ) {
      return reply({ error: 'invalid_request' }, 400);
    }

    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('code_verifier', verifier);
    form.set('redirect_uri', back.href);
  } else if (body.grant_type === 'refresh_token' && text(body.refresh_token)) {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', body.refresh_token);
  } else {
    return reply({ error: 'invalid_request' }, 400);
  }

  let res: Response;

  try {
    res = await env.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return reply({ error: 'unavailable' }, 502);
  }

  const answer = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    return reply(
      { error: typeof answer.error === 'string' ? answer.error : 'failed' },
      res.status >= 500 ? 502 : 400,
    );
  }

  const keep = ['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type'];

  return reply(Object.fromEntries(Object.entries(answer).filter(([k]) => keep.includes(k))));
}
