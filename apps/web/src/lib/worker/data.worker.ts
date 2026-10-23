// SPDX-License-Identifier: AGPL-3.0-only
// The data worker: the only place the data key and decrypted records live.
import * as Comlink from 'comlink';
import { DataService } from './service.ts';
import { indexedDbStorage } from './storage.ts';

const service = new DataService(indexedDbStorage(), {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  // Cloudflare Pages runs the relay next to the app (functions/api/prices).
  relayUrl: new URL('/api/prices/', self.location.origin).toString(),
});

const api = Object.assign(service, {
  /** The screens pass a callback to hear about auto-lock. */
  listenForLock(callback: () => void) {
    service.onLock = callback;
  },
});

Comlink.expose(api);
export type WorkerApi = typeof api;
