// SPDX-License-Identifier: AGPL-3.0-only
// Paths are relative to the vault's folder: `keyring.json`, `log/<deviceId>/<seq>.pvc`, `snap/<hlc>.pvc`.

/** Remote storage. Each provider is scoped to one vault's folder. */
export interface StorageProvider {
  id: string;
  label: string;
  /** Origins the provider talks to; they feed the CSP connect-src. */
  origins: string[];
  list(prefix: string): Promise<{ path: string; size: number }[]>;
  read(path: string): Promise<Uint8Array>;
  /** Creates or overwrites. Only keyring.json is ever overwritten. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

/** Storage on this device: encrypted chunks plus small bookkeeping values. */
export interface LocalStore {
  listChunks(): Promise<string[]>;
  getChunk(path: string): Promise<Uint8Array | undefined>;
  putChunk(path: string, bytes: Uint8Array): Promise<void>;
  deleteChunk(path: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export class OfflineError extends Error {
  override name = 'OfflineError';
}

/** A provider held in memory, for tests and the demo vault. */
export class MemoryProvider implements StorageProvider {
  id = 'memory';
  label = 'Memory (tests)';
  origins: string[] = [];
  files = new Map<string, Uint8Array>();
  offline = false;

  private check(): void {
    if (this.offline) {
      throw new OfflineError('offline');
    }
  }
  async list(prefix: string) {
    this.check();

    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, bytes]) => ({ path, size: bytes.length }));
  }
  async read(path: string) {
    this.check();
    const bytes = this.files.get(path);

    if (!bytes) {
      throw new Error(`Not found: ${path}`);
    }

    return bytes.slice();
  }
  async write(path: string, bytes: Uint8Array) {
    this.check();
    this.files.set(path, bytes.slice());
  }
  async remove(path: string) {
    this.check();
    this.files.delete(path);
  }
}

export class MemoryLocalStore implements LocalStore {
  chunks = new Map<string, Uint8Array>();
  meta = new Map<string, unknown>();

  async listChunks() {
    return [...this.chunks.keys()].sort();
  }
  async getChunk(path: string) {
    return this.chunks.get(path)?.slice();
  }
  async putChunk(path: string, bytes: Uint8Array) {
    this.chunks.set(path, bytes.slice());
  }
  async deleteChunk(path: string) {
    this.chunks.delete(path);
  }
  async getMeta<T>(key: string) {
    return structuredClone(this.meta.get(key)) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, structuredClone(value));
  }
}
