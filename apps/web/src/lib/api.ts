// SPDX-License-Identifier: AGPL-3.0-only
// The screens' handle on the data worker.
import type { EntityMap, EntityName } from '@pv/core';
import * as Comlink from 'comlink';

import type { WorkerApi } from './worker/data.worker.ts';

let remote: Comlink.Remote<WorkerApi> | undefined;

export function api(): Comlink.Remote<WorkerApi> {
  remote ??= Comlink.wrap<WorkerApi>(
    new Worker(new URL('./worker/data.worker.ts', import.meta.url), { type: 'module' }),
  );

  return remote;
}

export const proxy = Comlink.proxy;

/** Every record of one kind. Comlink loses the generic, so it is restored here. */
export function list<K extends EntityName>(entity: K): Promise<EntityMap[K][]> {
  return api().list(entity) as Promise<EntityMap[K][]>;
}
