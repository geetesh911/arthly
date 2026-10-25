// SPDX-License-Identifier: AGPL-3.0-only
// Google's sign-in page, asked for the authorization code flow with PKCE. The screens open it; the
// data worker swaps the code for tokens through the app's token function (token-server.ts).
import { sha256 } from '@noble/hashes/sha2.js';

import { randomBytes, toBase64, toHex, utf8 } from '../../../util/bytes.ts';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Only the files the app made itself: Google lists this permission as non-sensitive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Where Google sends the sign-in back to, next to the app's index.html. */
export const CALLBACK_PAGE = 'oauth.html';

const base64Url = (bytes: Uint8Array) =>
  toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** S256 of a verifier, as Google checks it. */
export const pkceChallenge = (verifier: string) => base64Url(sha256(utf8.encode(verifier)));

/** A PKCE verifier and its challenge, plus a state value to match Google's answer to the ask. */
export function pkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64Url(randomBytes(32));

  return { verifier, challenge: pkceChallenge(verifier), state: toHex(randomBytes(16)) };
}

export function googleAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    // A refresh token, every time: Google only sends one on a consent it shows.
    access_type: 'offline',
    prompt: 'consent',
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
  });

  return `${GOOGLE_AUTH_URL}?${params}`;
}
