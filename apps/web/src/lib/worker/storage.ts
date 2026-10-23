// SPDX-License-Identifier: AGPL-3.0-only
// IndexedDB on the device: one database per vault (`pv-<vaultId>`) plus a small index of vaults.
import type { LocalStore } from '@pv/core';

export interface VaultEntry {
  vaultId: string;
  name: string;
  created: string;
}

export interface DeviceStorage {
  vaults(): Promise<VaultEntry[]>;
  addVault(entry: VaultEntry): Promise<void>;
  removeVault(vaultId: string): Promise<void>;
  open(vaultId: string): Promise<LocalStore>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(name: string, stores: string[]): Promise<IDBDatabase> {
  const req = indexedDB.open(name, 1);
  req.onupgradeneeded = () => {
    for (const store of stores)
      if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
  };
  return request(req);
}

class IdbStore implements LocalStore {
  constructor(private db: IDBDatabase) {}

  private store(name: string, mode: IDBTransactionMode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  async listChunks() {
    return ((await request(this.store('chunks').getAllKeys())) as string[]).sort();
  }
  async getChunk(path: string) {
    return (await request(this.store('chunks').get(path))) as Uint8Array | undefined;
  }
  async putChunk(path: string, bytes: Uint8Array) {
    await request(this.store('chunks', 'readwrite').put(bytes, path));
  }
  async deleteChunk(path: string) {
    await request(this.store('chunks', 'readwrite').delete(path));
  }
  async getMeta<T>(key: string) {
    return (await request(this.store('meta').get(key))) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    await request(this.store('meta', 'readwrite').put(value, key));
  }
}

export function indexedDbStorage(): DeviceStorage {
  const index = openDb('pv-index', ['vaults']);
  const tx = async (mode: IDBTransactionMode) =>
    (await index).transaction('vaults', mode).objectStore('vaults');
  return {
    async vaults() {
      return (await request((await tx('readonly')).getAll())) as VaultEntry[];
    },
    async addVault(entry) {
      await request((await tx('readwrite')).put(entry, entry.vaultId));
    },
    async removeVault(vaultId) {
      await request((await tx('readwrite')).delete(vaultId));
      await request(indexedDB.deleteDatabase(`pv-${vaultId}`));
    },
    async open(vaultId) {
      return new IdbStore(await openDb(`pv-${vaultId}`, ['chunks', 'meta']));
    },
  };
}
