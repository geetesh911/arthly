// SPDX-License-Identifier: AGPL-3.0-only
import { ENTITY_NAMES, type EntityMap, type EntityName } from '../model/types.ts';

import { type Event, type Finding, type ImportApplyData, type Put, upgrade } from './events.ts';

export interface Version<T> {
  value: T;
  hlc: string;
  batchId?: string;
}

export type Tables = { [K in EntityName]: Map<string, Version<EntityMap[K]>> };

export interface Batch {
  batchId: string;
  hlc: string;
  importer: ImportApplyData['importer'];
  file: ImportApplyData['file'];
  memberId?: string;
  asOf?: string;
  /** `entity:id` of every record in the batch. */
  keys: string[];
  findings: Finding[];
  /** The hlc of the revert, when undone. */
  reverted?: string;
  /** Records edited after the import, which stay after a revert. */
  kept?: string[];
}

/** `value` is absent when that side was a delete. */
export interface Conflict {
  entity: EntityName;
  id: string;
  winner: { hlc: string; value?: unknown };
  loser: { hlc: string; value?: unknown };
}

export interface State {
  tables: Tables;
  /** `entity:id` → hlc of the delete. */
  deleted: Map<string, string>;
  batches: Map<string, Batch>;
  /** Open conflict notices, by `entity:id`. A later write to the record closes it. */
  conflicts: Map<string, Conflict>;
  /** True when an event of a newer format was seen; the app must not write. */
  readOnly: boolean;
  /** The latest hlc applied. */
  head: string;
}

export const keyOf = (entity: EntityName, id: string): string => `${entity}:${id}`;

export function emptyState(): State {
  const tables = Object.fromEntries(ENTITY_NAMES.map((n) => [n, new Map()])) as unknown as Tables;

  return {
    tables,
    deleted: new Map(),
    batches: new Map(),
    conflicts: new Map(),
    readOnly: false,
    head: '',
  };
}

/** Sorts by hlc and drops duplicates. */
export function orderEvents(events: Iterable<Event>): Event[] {
  const byHlc = new Map<string, Event>();

  for (const e of events) {
    if (!byHlc.has(e.hlc)) {
      byHlc.set(e.hlc, e);
    }
  }

  return [...byHlc.values()].sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
}

/** Replays the log into state. Any order or duplication of the same events gives the same state. */
export function replay(events: Iterable<Event>): State {
  const state = emptyState();
  const ordered: Event[] = [];

  for (const raw of orderEvents(events)) {
    const event = upgrade(raw);

    if (event) {
      ordered.push(event);
    } else {
      state.readOnly = true;
    }
  }

  // An undone import is replayed as if it never happened.
  const reverts = new Map<string, string>();

  for (const e of ordered) {
    if (e.type === 'import.revert' && !reverts.has(e.data.batchId)) {
      reverts.set(e.data.batchId, e.hlc);
    }
  }

  const skippedHlcs = new Set<string>();

  for (const e of ordered) {
    if (e.type === 'import.apply' && reverts.has(e.data.batchId)) {
      skippedHlcs.add(e.hlc);
    }
  }

  for (const e of ordered) {
    state.head = e.hlc;

    switch (e.type) {
      case 'entity.put':
        write(state, e.data, e.hlc, undefined, e.data.base, skippedHlcs);
        break;

      case 'entity.delete':
        remove(state, e.data.entity, e.data.id, e.hlc, e.data.base, skippedHlcs);
        break;

      case 'import.apply': {
        const { batchId } = e.data;

        if (state.batches.has(batchId)) {
          break;
        }

        state.batches.set(batchId, {
          batchId,
          hlc: e.hlc,
          importer: e.data.importer,
          file: e.data.file,
          ...(e.data.memberId ? { memberId: e.data.memberId } : {}),
          ...(e.data.asOf ? { asOf: e.data.asOf } : {}),
          keys: e.data.puts.map((p) => keyOf(p.entity, p.id)),
          findings: e.data.findings ?? [],
          ...(reverts.has(batchId) ? { reverted: reverts.get(batchId)! } : {}),
        });

        if (!reverts.has(batchId)) {
          for (const p of e.data.puts) {
            write(state, p, e.hlc, batchId);
          }
        }

        break;
      }

      case 'import.revert':
        break;
    }
  }

  for (const batch of state.batches.values()) {
    if (!batch.reverted) {
      continue;
    }

    batch.kept = batch.keys.filter((key) => {
      const current = currentHlc(state, key);

      return current !== undefined && current > batch.hlc;
    });
  }

  return state;
}

function currentHlc(state: State, key: string): string | undefined {
  const [entity, ...rest] = key.split(':') as [EntityName, ...string[]];

  return state.tables[entity].get(rest.join(':'))?.hlc ?? state.deleted.get(key);
}

function noteConflict(
  state: State,
  entity: EntityName,
  id: string,
  hlc: string,
  value: unknown,
  base: string | undefined,
  skipped: Set<string> | undefined,
): void {
  const key = keyOf(entity, id);
  const current = state.tables[entity].get(id);
  const currentDelete = state.deleted.get(key);
  const seen = current?.hlc ?? currentDelete;

  if (base !== undefined && seen !== undefined && base !== seen && !skipped?.has(base)) {
    state.conflicts.set(key, {
      entity,
      id,
      winner: value === undefined ? { hlc } : { hlc, value },
      loser: current ? { hlc: current.hlc, value: current.value } : { hlc: seen },
    });
  } else {
    state.conflicts.delete(key);
  }
}

function write(
  state: State,
  put: Put,
  hlc: string,
  batchId?: string,
  base?: string,
  skipped?: Set<string>,
): void {
  if (put.value.id !== put.id) {
    return;
  }

  noteConflict(state, put.entity, put.id, hlc, put.value, base, skipped);
  const table = state.tables[put.entity] as Map<string, Version<unknown>>;

  table.set(put.id, batchId ? { value: put.value, hlc, batchId } : { value: put.value, hlc });
  state.deleted.delete(keyOf(put.entity, put.id));
}

function remove(
  state: State,
  entity: EntityName,
  id: string,
  hlc: string,
  base?: string,
  skipped?: Set<string>,
): void {
  noteConflict(state, entity, id, hlc, undefined, base, skipped);
  state.tables[entity].delete(id);
  state.deleted.set(keyOf(entity, id), hlc);
}

export function get<K extends EntityName>(
  state: State,
  entity: K,
  id: string,
): EntityMap[K] | undefined {
  return state.tables[entity].get(id)?.value as EntityMap[K] | undefined;
}

export function all<K extends EntityName>(state: State, entity: K): EntityMap[K][] {
  return [...state.tables[entity].values()].map((v) => v.value as EntityMap[K]);
}

/** The hlc to pass as `base` when editing a record. */
export function versionOf(state: State, entity: EntityName, id: string): string | undefined {
  return currentHlc(state, keyOf(entity, id));
}
