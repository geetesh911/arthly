// SPDX-License-Identifier: AGPL-3.0-only
// Cloud sync for the open vault: its Google Drive connection, the sign-in sealed on this device,
// and when to run a sync pass (§8 of the design, and the cloud sync spec).
import {
  GoogleDrive,
  type GoogleDriveFolder,
  GoogleSession,
  type GoogleTokens,
  type LocalStore,
  OfflineError,
  openChunk,
  ReconnectError,
  sealChunk,
  type VaultLog,
} from '@pv/core';

import type { CloudStatusDto } from './dto.ts';

/** Kept in the device's meta store as 'cloud'. Each device connects on its own; none of it syncs. */
interface Connection {
  provider: 'google-drive';
  folderId: string;
  account?: string;
  connected: string;
  /** When the last pass finished without an error. */
  lastSync?: string;
}

export interface CloudEnv {
  fetch: typeof fetch;
  now: () => Date;
  tokens: GoogleTokens;
  /** False leaves every pass to `run`, as tests do. */
  auto: boolean;
}

/** The refresh token, sealed with the data key in the meta key 'cloud:secret'. */
const SECRET = 'cloud/secret';
const AFTER_CHANGE_MS = 5000;
const EVERY_MS = 5 * 60_000;
/** Coming back to the app or online syncs only if the last pass is older than this. */
const STALE_MS = 60_000;

export class CloudSync {
  private connection?: Connection;
  private session?: GoogleSession;
  private folder?: GoogleDriveFolder;
  private flags: Pick<CloudStatusDto, 'retrying' | 'reconnect' | 'error'> = {};
  private syncing = false;
  private stopped = false;
  private lastRun = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private every?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private queued?: Promise<void>;
  /** Cuts off a pass's Drive requests when the vault locks. */
  private abort = new AbortController();
  private drive = (input: RequestInfo | URL, init?: RequestInit) =>
    this.env.fetch(input, { ...init, signal: this.abort.signal });

  private constructor(
    private vault: { vaultId: string; dk: CryptoKey; local: LocalStore; log: VaultLog },
    private env: CloudEnv,
    /** Hears every status change, and whether a pass brought in anything new. */
    private listener: (status: CloudStatusDto, pulled: boolean) => void,
  ) {}

  /** The vault's saved connection, if it has one. */
  static async load(
    vault: { vaultId: string; dk: CryptoKey; local: LocalStore; log: VaultLog },
    env: CloudEnv,
    listener: (status: CloudStatusDto, pulled: boolean) => void,
  ): Promise<CloudSync> {
    const cloud = new CloudSync(vault, env, listener);

    cloud.connection = await vault.local.getMeta<Connection>('cloud');

    if (cloud.connection) {
      try {
        const sealed = await vault.local.getMeta<Uint8Array>('cloud:secret');
        const { refreshToken } = await openChunk<{ refreshToken: string }>(
          vault.dk,
          vault.vaultId,
          SECRET,
          sealed!,
        );

        cloud.session = new GoogleSession(refreshToken, env.tokens, () => env.now().getTime());
      } catch {
        cloud.flags = { reconnect: true };
      }
    }

    return cloud;
  }

  status(): CloudStatusDto {
    const c = this.connection;

    return {
      available: true,
      ...(c
        ? {
            provider: c.provider,
            ...(c.account ? { account: c.account } : {}),
            ...(c.lastSync ? { lastSync: c.lastSync } : {}),
          }
        : {}),
      syncing: this.syncing,
      ...this.flags,
      problems: this.vault.log.problems.length,
    };
  }

  lastSync(): string | undefined {
    return this.connection?.lastSync;
  }

  /** Syncs now, then every 5 minutes. */
  start(): void {
    this.stopped = false;
    this.repeat();
    this.soon(0);
  }

  /** For good, as the vault locks: cuts off a running pass, and resolves once it has ended. */
  stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.every);
    this.abort.abort();

    return this.queued ?? this.running ?? Promise.resolve();
  }

  /** Syncs shortly, as after a change; another change before then pushes it back. */
  soon(ms = AFTER_CHANGE_MS): void {
    if (!this.env.auto || !this.session || this.stopped) {
      return;
    }

    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  /** Syncs if the last pass was over a minute ago, as when the app comes back into view. */
  ifStale(): void {
    if (this.env.now().getTime() - this.lastRun > STALE_MS) {
      this.soon(0);
    }
  }

  /** Connects to the vault's folder in Google Drive, making it if needed, and syncs. */
  async connect(session: GoogleSession, folderId?: string): Promise<void> {
    const drive = new GoogleDrive(this.drive, session);
    const id = folderId ?? (await drive.vaultFolder(this.vault.vaultId, true))!;
    const account = await drive.account();

    this.connection = {
      provider: 'google-drive',
      folderId: id,
      ...(account ? { account } : {}),
      connected: this.env.now().toISOString(),
    };
    await this.vault.local.setMeta('cloud', this.connection);
    await this.vault.local.setMeta(
      'cloud:secret',
      await sealChunk(this.vault.dk, this.vault.vaultId, SECRET, {
        refreshToken: session.refreshToken,
      }),
    );
    this.session = session;
    this.folder = undefined;
    this.flags = {};
    await this.run();
    this.repeat();
  }

  /** Forgets this device's sign-in. The files stay in Google Drive for the other devices. */
  async disconnect(): Promise<void> {
    clearTimeout(this.timer);
    clearInterval(this.every);
    this.connection = undefined;
    this.session = undefined;
    this.folder = undefined;
    this.flags = {};
    await this.vault.local.setMeta('cloud', undefined);
    await this.vault.local.setMeta('cloud:secret', undefined);
    this.listener(this.status(), false);
  }

  /** One pass. A call during a pass runs one more after it, so it covers every change so far. */
  run(): Promise<void> {
    if (!this.running) {
      this.running = this.pass().finally(() => (this.running = undefined));

      return this.running;
    }

    this.queued ??= this.running.then(() => {
      this.queued = undefined;

      return this.run();
    });

    return this.queued;
  }

  private repeat(): void {
    clearInterval(this.every);

    if (this.env.auto && this.session && !this.stopped) {
      this.every = setInterval(() => void this.run(), EVERY_MS);
    }
  }

  private async pass(): Promise<void> {
    const session = this.session;

    if (!this.connection || !session || this.stopped) {
      return;
    }

    this.folder ??= new GoogleDrive(this.drive, session).folder(this.connection.folderId);
    let pulled = false;

    this.syncing = true;
    this.listener(this.status(), false);

    try {
      const report = await this.vault.log.sync(this.folder);

      pulled = report.pulled > 0 || report.keyringChanged;
      this.flags = {};

      // Disconnecting during the pass leaves it disconnected.
      if (this.connection && this.session === session) {
        this.connection = { ...this.connection, lastSync: this.env.now().toISOString() };
        await this.vault.local.setMeta('cloud', this.connection);
      }
    } catch (error) {
      // Connecting again during the pass makes its outcome stale.
      if (this.session !== session) {
        return;
      }

      if (error instanceof OfflineError) {
        this.flags = { retrying: true };
      } else if (error instanceof ReconnectError) {
        // Nothing more runs until the user connects again.
        this.flags = { reconnect: true };
        this.session = undefined;
        this.folder = undefined;
        clearInterval(this.every);
      } else {
        this.flags = { error: (error as Error).message };
      }
    } finally {
      this.syncing = false;
      this.lastRun = this.env.now().getTime();
      this.listener(this.status(), pulled);
    }
  }
}
