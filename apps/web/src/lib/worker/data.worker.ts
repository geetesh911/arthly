// SPDX-License-Identifier: AGPL-3.0-only
// The data worker: the only place the data key and decrypted records live.
import * as Comlink from 'comlink';

import type { CloudStatusDto } from './dto.ts';
import { DataService } from './service.ts';
import { indexedDbStorage } from './storage.ts';

const service = new DataService(indexedDbStorage(), {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  // Cloudflare Pages runs the relay next to the app (functions/api/prices), and the Google token
  // function beside it (functions/api/google).
  relayUrl: new URL('/api/prices/', self.location.origin).toString(),
  locks: self.navigator.locks,
});

const api = Object.assign(service, {
  /** The screens pass a callback to hear about auto-lock, and why if another tab caused it. */
  listenForLock(callback: (reason?: string) => void) {
    service.onLock = callback;
  },
  /** The screens hear each cloud sync status, and whether it brought in changes. */
  listenForSync(callback: (status: CloudStatusDto, pulled: boolean) => void) {
    service.onSync = callback;
  },
});

// Back online: sync if it's been a while.
self.addEventListener('online', () => service.syncIfStale());

Comlink.expose(api);
export type WorkerApi = typeof api;
