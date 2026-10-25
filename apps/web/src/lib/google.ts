// SPDX-License-Identifier: AGPL-3.0-only
// Signing in to Google for cloud sync. The screens open Google's page in a popup, which reports back
// through static/oauth.js; the data worker then swaps the code for tokens. An app installed to the
// home screen may keep its storage apart from the browser's popups, so it goes to Google and back
// in the same window, and the result waits in sessionStorage until the screens pick it up.
import { CALLBACK_PAGE, googleAuthUrl, type GoogleGrant, pkce } from '@pv/core';

export type GooglePurpose = 'connect' | 'open';

/** Shared with static/oauth.js. */
const CHANNEL = 'arthly-google';
const PENDING = 'arthly-google';
const RESULT = 'arthly-google-result';

interface Ready {
  clientId: string;
  verifier: string;
  challenge: string;
  state: string;
}

let ready: Ready | null = null;

const redirectUri = () => new URL(CALLBACK_PAGE, location.href).href;
const installed = () =>
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

/**
 * Asks the app's token function for its Google client, and makes a fresh PKCE pair, so that a
 * click can open Google straight away. False when this copy of the app has no Google client.
 */
export async function prepareGoogle(): Promise<boolean> {
  try {
    const res = await fetch('/api/google/config');
    const { clientId } = res.ok ? ((await res.json()) as { clientId?: string }) : {};

    ready = clientId ? { clientId, ...pkce() } : null;
  } catch {
    ready = null;
  }

  return ready !== null;
}

/**
 * Opens Google's sign-in. Call it straight from a click, before any await, or the popup is
 * blocked. Gives null if it's cancelled, or when the page is leaving for Google instead.
 * `vaultId` is the portfolio to connect, so a redirect back connects only that one.
 */
export function signInWithGoogle(
  purpose: GooglePurpose,
  signal?: AbortSignal,
  vaultId?: string,
): Promise<GoogleGrant | null> {
  const r = ready;

  if (!r) {
    return Promise.reject(new Error('Google Drive isn’t set up for this copy of Arthly.'));
  }

  // Each sign-in gets its own verifier and state.
  ready = { clientId: r.clientId, ...pkce() };
  const url = googleAuthUrl({
    clientId: r.clientId,
    redirectUri: redirectUri(),
    state: r.state,
    challenge: r.challenge,
  });
  const popup = installed()
    ? null
    : window.open(url, 'arthly-google', 'popup,width=480,height=640');

  if (!popup) {
    sessionStorage.setItem(
      PENDING,
      JSON.stringify({ purpose, vaultId, state: r.state, verifier: r.verifier }),
    );
    location.assign(url);

    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL);

    const cancel = () => {
      channel.close();
      resolve(null);
    };

    signal?.addEventListener('abort', cancel, { once: true });

    channel.onmessage = ({
      data,
    }: MessageEvent<{ state?: string; code?: string; error?: string }>) => {
      if (data.state !== r.state) {
        return;
      }

      channel.close();
      signal?.removeEventListener('abort', cancel);

      if (data.code) {
        resolve({ code: data.code, verifier: r.verifier, redirectUri: redirectUri() });
      } else if (data.error === 'access_denied') {
        resolve(null);
      } else {
        reject(new Error(`Google sign-in failed (${data.error ?? 'no answer'})`));
      }
    };
  });
}

/** A sign-in that came back to this window after a full-page redirect, for this purpose. */
export function takeGoogleRedirect(purpose: GooglePurpose, vaultId?: string): GoogleGrant | null {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null') as {
      purpose: GooglePurpose;
      vaultId?: string;
      state: string;
      verifier: string;
    } | null;
    const result = JSON.parse(sessionStorage.getItem(RESULT) ?? 'null') as {
      state?: string;
      code?: string;
    } | null;

    // Started from another portfolio: it waits for that one to be unlocked.
    if (pending?.purpose !== purpose || pending.vaultId !== vaultId || !result) {
      return null;
    }

    sessionStorage.removeItem(PENDING);
    sessionStorage.removeItem(RESULT);

    return result.code && result.state === pending.state
      ? { code: result.code, verifier: pending.verifier, redirectUri: redirectUri() }
      : null;
  } catch {
    return null;
  }
}
