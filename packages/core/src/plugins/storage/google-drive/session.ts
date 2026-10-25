// SPDX-License-Identifier: AGPL-3.0-only
// One device's Google sign-in: a refresh token, kept sealed on the device, turned into one-hour
// access tokens by the app's token function (functions/api/google/[route].ts).
import { OfflineError } from '../../../sync/stores.ts';

import { DriveError, ReconnectError } from './drive.ts';
import { DRIVE_SCOPE } from './oauth.ts';

export interface TokenAnswer {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** What the screens hand the data worker after Google's sign-in page. */
export interface GoogleGrant {
  code: string;
  verifier: string;
  redirectUri: string;
}

/** The app's token function, such as https://example.pages.dev/api/google/token. */
export class GoogleTokens {
  constructor(
    private fetcher: typeof fetch,
    private url: string,
  ) {}

  /** Swaps the code from Google's sign-in page for tokens, checking the Drive box was ticked. */
  async exchange(grant: GoogleGrant): Promise<TokenAnswer & { refresh_token: string }> {
    const answer = await this.post({
      grant_type: 'authorization_code',
      code: grant.code,
      code_verifier: grant.verifier,
      redirect_uri: grant.redirectUri,
    });

    if (!answer.scope?.split(' ').includes(DRIVE_SCOPE)) {
      throw new DriveError(
        'Arthly needs to see its own files in your Google Drive. Connect again and tick the box for Google Drive.',
      );
    }

    if (!answer.refresh_token) {
      throw new DriveError('Google didn’t send a lasting sign-in. Connect again.');
    }

    return { ...answer, refresh_token: answer.refresh_token };
  }

  refresh(refreshToken: string): Promise<TokenAnswer> {
    return this.post({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async post(body: Record<string, string>): Promise<TokenAnswer> {
    let res: Response;

    try {
      res = await this.fetcher(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new OfflineError('The sign-in service could not be reached');
    }

    const answer = (await res.json().catch(() => ({}))) as Partial<TokenAnswer> & {
      error?: string;
    };

    if (res.ok && answer.access_token) {
      return answer as TokenAnswer;
    }

    if (answer.error === 'invalid_grant') {
      throw new ReconnectError('Google Drive needs you to sign in again');
    }

    if (answer.error === 'not_configured') {
      throw new DriveError('Google Drive isn’t set up for this copy of Arthly');
    }

    if (res.status === 429 || res.status >= 500) {
      throw new OfflineError('The sign-in service is busy');
    }

    throw new DriveError(`Google sign-in failed${answer.error ? ` (${answer.error})` : ''}`);
  }
}

export class GoogleSession {
  private access?: { token: string; expires: number };

  constructor(
    readonly refreshToken: string,
    private tokens: GoogleTokens,
    private now: () => number,
    first?: TokenAnswer,
  ) {
    if (first) {
      this.keep(first);
    }
  }

  /** Signs in with what Google's sign-in page sent back. */
  static async start(tokens: GoogleTokens, grant: GoogleGrant, now: () => number) {
    const answer = await tokens.exchange(grant);

    return new GoogleSession(answer.refresh_token, tokens, now, answer);
  }

  /** A current access token; `fresh` gets a new one even if the last hasn't expired. */
  async token(fresh = false): Promise<string> {
    // A minute's margin, so a token doesn't expire on its way to Google.
    if (!fresh && this.access && this.access.expires - 60_000 > this.now()) {
      return this.access.token;
    }

    return this.keep(await this.tokens.refresh(this.refreshToken));
  }

  private keep(answer: TokenAnswer): string {
    this.access = { token: answer.access_token, expires: this.now() + answer.expires_in * 1000 };

    return answer.access_token;
  }
}
