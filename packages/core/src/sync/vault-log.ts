// SPDX-License-Identifier: AGPL-3.0-only
// The device's copy of the change log, and the sync pass that merges it with other devices.
import { ChunkError, openChunk, sealChunk } from '../crypto/chunk.ts';
import { type Keyring, mergeKeyrings, sameKeyring } from '../crypto/keyring.ts';
import type { Event } from '../log/events.ts';
import { type Clock, createClock } from '../log/hlc.ts';
import { newDeviceId } from '../model/ids.ts';
import { utf8 } from '../util/bytes.ts';

import type { LocalStore, StorageProvider } from './stores.ts';

export interface SnapPayload {
  /** How far the snap covers each device's chunks. */
  marks: Record<string, number>;
  events: Event[];
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  /** Chunks that failed to decrypt or failed their checks; they are skipped. */
  problems: string[];
  compacted: boolean;
  keyringChanged: boolean;
  /** The remote keyring wasn't signed with this vault's key and was ignored. */
  keyringRejected: boolean;
}

export class SyncError extends Error {
  override name = 'SyncError';
}

const KEYRING = 'keyring.json';
const CHUNK = /^log\/([a-z2-7]+)\/(\d{8})\.pvc$/;
/** Seal the open chunk locally once it holds this many events, even without sync. */
const OPEN_LIMIT = 1000;
const DEFAULT_COMPACT_AFTER = 200;

export const chunkPath = (deviceId: string, seq: number) =>
  `log/${deviceId}/${String(seq).padStart(8, '0')}.pvc`;

export function parseChunkPath(path: string): { deviceId: string; seq: number } | null {
  const m = CHUNK.exec(path);

  return m ? { deviceId: m[1]!, seq: Number(m[2]) } : null;
}

interface Meta {
  /** This device's open chunk; every lower seq is sealed. */
  openSeq: number;
  /** Highest own seq uploaded. */
  uploaded: number;
  /** Per other device, the highest seq read. */
  marks: Record<string, number>;
  /** Snaps already read or written. */
  snaps: string[];
  /** Highest own seq covered by a snap at the provider. */
  covered: number;
}

const freshMeta = (): Meta => ({ openSeq: 1, uploaded: 0, marks: {}, snaps: [], covered: 0 });

export class VaultLog {
  readonly problems: string[] = [];
  clock: Clock;
  /** Called after this device saves events or changes the keyring, so sync can follow. */
  onChange?: () => void;
  private known = new Map<string, Event>();
  private openEvents: Event[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private local: LocalStore,
    private dk: CryptoKey,
    public keyring: Keyring,
    readonly deviceId: string,
    private meta: Meta,
  ) {
    this.clock = createClock(deviceId);
  }

  /** Opens the log stored on this device, creating the device ID on first use. */
  static async open(local: LocalStore, dk: CryptoKey, keyring: Keyring): Promise<VaultLog> {
    let deviceId = await local.getMeta<string>('deviceId');

    if (!deviceId) {
      deviceId = newDeviceId();
      await local.setMeta('deviceId', deviceId);
    }

    await local.setMeta('keyring', keyring);
    const meta = { ...freshMeta(), ...(await local.getMeta<Meta>('sync')) };
    const log = new VaultLog(local, dk, keyring, deviceId, meta);

    for (const path of await local.listChunks()) {
      const bytes = await local.getChunk(path);

      if (!bytes) {
        continue;
      }

      try {
        const events = await log.decode(path, bytes);

        log.add(events);

        if (path === chunkPath(deviceId, meta.openSeq)) {
          log.openEvents = events;
        }
      } catch (error) {
        if (!(error instanceof ChunkError)) {
          throw error;
        }

        log.problems.push(path);
      }
    }

    return log;
  }

  get vaultId(): string {
    return this.keyring.vaultId;
  }

  /** Every known event, in no particular order. */
  events(): Event[] {
    return [...this.known.values()];
  }

  /** Saves new events to this device. */
  append(events: Event[]): Promise<void> {
    return this.serial(async () => {
      const fresh = events.filter((e) => !this.known.has(e.hlc));

      if (fresh.length === 0) {
        return;
      }

      this.add(fresh);
      this.openEvents.push(...fresh);
      await this.writeOpen();

      if (this.openEvents.length >= OPEN_LIMIT) {
        await this.seal();
      }

      this.onChange?.();
    });
  }

  /** Stores a keyring changed on this device (new passphrase, passkey, revocation). */
  async setKeyring(keyring: Keyring): Promise<void> {
    await this.storeKeyring(keyring);
    this.onChange?.();
  }

  private async storeKeyring(keyring: Keyring): Promise<void> {
    this.keyring = keyring;
    await this.local.setMeta('keyring', keyring);
  }

  /** One sync pass with a provider (§8). Throws when offline; nothing is lost. */
  async sync(
    remote: StorageProvider,
    options: { compactAfter?: number } = {},
  ): Promise<SyncReport> {
    const report: SyncReport = {
      pulled: 0,
      pushed: 0,
      problems: [],
      compacted: false,
      keyringChanged: false,
      keyringRejected: false,
    };

    try {
      await this.syncKeyring(remote, report);
      const files = new Set((await remote.list('')).map((f) => f.path));

      await this.pullSnaps(remote, files, report);
      await this.pullChunks(remote, files, report);
      await this.serial(() => this.seal());
      await this.push(remote, files, report);
      const logCount = [...files].filter((p) => CHUNK.test(p)).length;

      if (logCount > (options.compactAfter ?? DEFAULT_COMPACT_AFTER)) {
        await this.compact(remote, files);
        report.compacted = true;
      }

      await this.cleanUp(remote, files);
    } finally {
      await this.saveMeta();
    }

    this.problems.push(...report.problems);

    return report;
  }

  private async syncKeyring(remote: StorageProvider, report: SyncReport): Promise<void> {
    const exists = (await remote.list(KEYRING)).some((f) => f.path === KEYRING);

    if (!exists) {
      await remote.write(KEYRING, utf8.encode(JSON.stringify(this.keyring)));

      return;
    }

    let theirs: Keyring;

    try {
      theirs = JSON.parse(utf8.decode(await remote.read(KEYRING))) as Keyring;
    } catch {
      throw new SyncError('The keyring in the remote folder is damaged');
    }

    if (theirs.vaultId !== this.vaultId) {
      throw new SyncError('The remote folder belongs to a different vault');
    }

    const { keyring, rejected } = await mergeKeyrings(this.keyring, theirs, this.dk);

    report.keyringRejected = rejected;

    if (rejected || !sameKeyring(keyring, theirs)) {
      await remote.write(KEYRING, utf8.encode(JSON.stringify(keyring)));
    }

    if (keyring !== this.keyring) {
      report.keyringChanged = true;
      await this.storeKeyring(keyring);
    }
  }

  /** Reads every snap not read before. A device that compacts keeps its newest snap. */
  private async pullSnaps(remote: StorageProvider, files: Set<string>, report: SyncReport) {
    const snaps = [...files].filter((p) => p.startsWith('snap/')).sort();

    for (const path of snaps) {
      if (this.meta.snaps.includes(path)) {
        continue;
      }

      const bytes = await remote.read(path);

      try {
        const snap = await openChunk<SnapPayload>(this.dk, this.vaultId, path, bytes);

        report.pulled += this.add(snap.events);
        await this.local.putChunk(path, bytes);
        this.noteMarks(snap.marks);
      } catch (error) {
        if (!(error instanceof ChunkError)) {
          throw error;
        }

        report.problems.push(path);
      }

      this.meta.snaps.push(path);
    }

    this.meta.snaps = this.meta.snaps.filter((p) => files.has(p));
  }

  private async pullChunks(remote: StorageProvider, files: Set<string>, report: SyncReport) {
    for (const path of [...files].sort()) {
      const chunk = parseChunkPath(path);

      if (!chunk || chunk.deviceId === this.deviceId) {
        continue;
      }

      if (chunk.seq <= (this.meta.marks[chunk.deviceId] ?? 0)) {
        continue;
      }

      const bytes = await remote.read(path);

      try {
        report.pulled += this.add(await this.decode(path, bytes));
        await this.local.putChunk(path, bytes);
      } catch (error) {
        if (!(error instanceof ChunkError)) {
          throw error;
        }

        report.problems.push(path);
      }

      this.meta.marks[chunk.deviceId] = chunk.seq;
    }
  }

  private async push(remote: StorageProvider, files: Set<string>, report: SyncReport) {
    for (let seq = this.meta.uploaded + 1; seq < this.meta.openSeq; seq++) {
      const path = chunkPath(this.deviceId, seq);
      const bytes = await this.local.getChunk(path);

      if (bytes) {
        await remote.write(path, bytes);
        files.add(path);
        report.pushed += 1;
      }

      this.meta.uploaded = seq;
    }
  }

  /** Writes a snap of every known event, then drops this device's older snaps. */
  private async compact(remote: StorageProvider, files: Set<string>): Promise<void> {
    const path = `snap/${this.clock.next()}.pvc`;
    const marks = { ...this.meta.marks, [this.deviceId]: this.meta.uploaded };
    const payload: SnapPayload = { marks, events: this.events() };

    await remote.write(path, await sealChunk(this.dk, this.vaultId, path, payload));

    for (const old of files) {
      if (old.startsWith('snap/') && old.endsWith(`.${this.deviceId}.pvc`)) {
        await remote.remove(old);
      }
    }

    files.add(path);
    this.meta.snaps.push(path);
    this.noteMarks(marks);
  }

  /** Deletes this device's remote chunks that a snap covers. Never touches other devices' files. */
  private async cleanUp(remote: StorageProvider, files: Set<string>): Promise<void> {
    for (const path of files) {
      const chunk = parseChunkPath(path);

      if (chunk?.deviceId === this.deviceId && chunk.seq <= this.meta.covered) {
        await remote.remove(path);
        files.delete(path);
      }
    }
  }

  private noteMarks(marks: Record<string, number>): void {
    for (const [deviceId, seq] of Object.entries(marks)) {
      if (deviceId === this.deviceId) {
        this.meta.covered = Math.max(this.meta.covered, seq);
      } else {
        this.meta.marks[deviceId] = Math.max(this.meta.marks[deviceId] ?? 0, seq);
      }
    }
  }

  private async decode(path: string, bytes: Uint8Array): Promise<Event[]> {
    const payload = await openChunk<unknown>(this.dk, this.vaultId, path, bytes);
    const events = path.startsWith('snap/') ? (payload as SnapPayload).events : payload;

    if (!Array.isArray(events)) {
      throw new ChunkError(`${path} has no events`);
    }

    return events as Event[];
  }

  /** Adds events, returning how many were new. */
  private add(events: Event[]): number {
    let added = 0;

    for (const e of events) {
      if (this.known.has(e.hlc)) {
        continue;
      }

      this.known.set(e.hlc, e);
      this.clock.observe(e.hlc);
      added += 1;
    }

    return added;
  }

  private async writeOpen(): Promise<void> {
    const path = chunkPath(this.deviceId, this.meta.openSeq);

    await this.local.putChunk(path, await sealChunk(this.dk, this.vaultId, path, this.openEvents));
  }

  /** Closes the open chunk, if it has events, and starts the next one. */
  private async seal(): Promise<void> {
    if (this.openEvents.length === 0) {
      return;
    }

    this.meta.openSeq += 1;
    this.openEvents = [];
    await this.saveMeta();
  }

  private saveMeta(): Promise<void> {
    return this.local.setMeta('sync', this.meta);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);

    this.queue = run.catch(() => undefined);

    return run;
  }

  /**
   * For backups: the sealed seq per device, and this device's chunks not yet uploaded.
   * A device restoring the backup takes over the events in those chunks.
   */
  backupIndex(): { marks: Record<string, number>; unsynced: string[] } {
    const unsynced: string[] = [];

    for (let seq = this.meta.uploaded + 1; seq <= this.meta.openSeq; seq++) {
      unsynced.push(chunkPath(this.deviceId, seq));
    }

    return { marks: { ...this.meta.marks, [this.deviceId]: this.meta.openSeq - 1 }, unsynced };
  }
}
