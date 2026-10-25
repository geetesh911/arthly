// SPDX-License-Identifier: AGPL-3.0-only
// Cloudflare Pages Function: GET /api/google/config and POST /api/google/token, for cloud sync with
// Google Drive. googleToken() says what it does and why. It needs GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET set in the Pages project; without them, the app says Drive isn't set up.
import { googleToken } from '../../../packages/core/src/plugins/storage/google-drive/token-server.ts';

interface Context {
  request: Request;
  params: { route?: string | string[] };
  env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
}

export function onRequest(context: Context): Promise<Response> {
  return googleToken(String(context.params.route), context.request, {
    fetch: (input, init) => fetch(input, init),
    clientId: context.env.GOOGLE_CLIENT_ID,
    clientSecret: context.env.GOOGLE_CLIENT_SECRET,
  });
}
