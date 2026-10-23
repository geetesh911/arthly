// SPDX-License-Identifier: AGPL-3.0-only
// The `.pvault` file: the keyring, every chunk on the device and a small index, in one JSON file.
// Chunks stay encrypted, so the file is as safe as the vault itself.
import type { Keyring } from '../crypto/keyring.ts';
import { openChunk } from '../crypto/chunk.ts';
import type { Event } from '../log/events.ts';
import { fromBase64, toBase64, utf8 } from '../util/bytes.ts';
import type { LocalStore } from './stores.ts';
import { VaultLog } from './vault-log.ts';

export interface BackupFile {
  format: 'pvault';
  version: 1;
  created: string;
  keyring: Keyring;
  /** The sealed seq per device: chunks up to here never change. */
  marks: Record<string, number>;
  /** The backing-up device's chunks not yet uploaded; the restoring device takes over their events. */
  unsynced: string[];
  chunks: Record<string, string>;
}

export class BackupError extends Error {
  override name = 'BackupError';
}

export async function makeBackup(
  log: VaultLog,
  local: LocalStore,
  now = new Date(),
): Promise<Uint8Array> {
  const chunks: Record<string, string> = {};
  for (const path of await local.listChunks()) {
    const bytes = await local.getChunk(path);
    if (bytes) chunks[path] = toBase64(bytes);
  }
  const file: BackupFile = {
    format: 'pvault',
    version: 1,
    created: now.toISOString(),
    keyring: log.keyring,
    ...log.backupIndex(),
    chunks,
  };
  return utf8.encode(JSON.stringify(file));
}

export function readBackup(bytes: Uint8Array): BackupFile {
  let file: BackupFile;
  try {
    file = JSON.parse(utf8.decode(bytes)) as BackupFile;
  } catch {
    throw new BackupError('This is not a backup file');
  }
  if (file?.format !== 'pvault' || !file.keyring?.vaultId || typeof file.chunks !== 'object') {
    throw new BackupError('This is not a backup file');
  }
  if (file.version > 1) throw new BackupError('This backup was made by a newer version of the app');
  return file;
}

/**
 * Restores a backup into an empty store on this device, once it has been unlocked with dk.
 * This device gets its own ID, and takes over the events that were still unsynced in the backup.
 */
export async function restoreBackup(
  file: BackupFile,
  local: LocalStore,
  dk: CryptoKey,
): Promise<VaultLog> {
  if ((await local.listChunks()).length > 0)
    throw new BackupError('This vault already has data here');
  const vaultId = file.keyring.vaultId;
  const unsynced = new Set(file.unsynced);
  const pending: Event[] = [];
  for (const [path, text] of Object.entries(file.chunks)) {
    const bytes = fromBase64(text);
    if (unsynced.has(path)) pending.push(...(await openChunk<Event[]>(dk, vaultId, path, bytes)));
    else await local.putChunk(path, bytes);
  }
  const marks: Record<string, number> = {};
  for (const [deviceId, seq] of Object.entries(file.marks)) if (seq > 0) marks[deviceId] = seq;
  await local.setMeta('sync', { marks });
  const log = await VaultLog.open(local, dk, file.keyring);
  await log.append(pending);
  return log;
}
