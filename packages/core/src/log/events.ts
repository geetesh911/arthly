// SPDX-License-Identifier: AGPL-3.0-only
import type { EntityMap, EntityName } from '../model/types.ts';

/** The data format this build writes and understands. */
export const FORMAT_VERSION = 2;

export type Put = { [K in EntityName]: { entity: K; id: string; value: EntityMap[K] } }[EntityName];

export interface ImportApplyData {
  /** Random per import, so re-importing a reverted file makes a new batch. */
  batchId: string;
  importer: { id: string; version: number };
  file: { name: string; sha256: string; size: number };
  memberId?: string;
  asOf?: string;
  puts: Put[];
  /** Problems found at import, such as file totals that don't match their lines. */
  findings?: Finding[];
}

export interface Finding {
  key: 'recon.total' | 'recon.unmatched';
  message: string;
}

interface Envelope<T extends string, D> {
  hlc: string;
  v: number;
  type: T;
  data: D;
}

export type PutEvent = Envelope<'entity.put', Put & { base?: string }>;
export type DeleteEvent = Envelope<
  'entity.delete',
  { entity: EntityName; id: string; base?: string }
>;
export type ImportApplyEvent = Envelope<'import.apply', ImportApplyData>;
export type ImportRevertEvent = Envelope<'import.revert', { batchId: string }>;

export type Event = PutEvent | DeleteEvent | ImportApplyEvent | ImportRevertEvent;
export type EventType = Event['type'];

type Upgrader = (event: Event) => Event;

/** Lifts events of format v to v + 1. Stored events are never rewritten. */
const UPGRADERS: Record<number, Upgrader> = {
  // Format 2 added loans. Older events need no change.
  1: (event) => ({ ...event, v: 2 }),
};

/** Brings an event to the current format, or returns null if it is newer than this build. */
export function upgrade(event: Event): Event | null {
  if (event.v > FORMAT_VERSION) {
    return null;
  }

  let current = event;

  while (current.v < FORMAT_VERSION) {
    const lift = UPGRADERS[current.v];

    if (!lift) {
      throw new Error(`No upgrader from format ${current.v}`);
    }

    current = lift(current);
  }

  return current;
}

export function putEvent<K extends EntityName>(
  hlc: string,
  entity: K,
  value: EntityMap[K],
  base?: string,
): PutEvent {
  const data = { entity, id: value.id, value, ...(base ? { base } : {}) } as PutEvent['data'];

  return { hlc, v: FORMAT_VERSION, type: 'entity.put', data };
}

export function deleteEvent(
  hlc: string,
  entity: EntityName,
  id: string,
  base?: string,
): DeleteEvent {
  return {
    hlc,
    v: FORMAT_VERSION,
    type: 'entity.delete',
    data: { entity, id, ...(base ? { base } : {}) },
  };
}

export function importApplyEvent(hlc: string, data: ImportApplyData): ImportApplyEvent {
  return { hlc, v: FORMAT_VERSION, type: 'import.apply', data };
}

export function importRevertEvent(hlc: string, batchId: string): ImportRevertEvent {
  return { hlc, v: FORMAT_VERSION, type: 'import.revert', data: { batchId } };
}
