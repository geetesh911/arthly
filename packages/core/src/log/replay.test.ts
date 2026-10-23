// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Member } from '../model/types.ts';

import {
  deleteEvent,
  type Event,
  type ImportApplyData,
  importApplyEvent,
  importRevertEvent,
  putEvent,
} from './events.ts';
import { formatHlc } from './hlc.ts';
import { all, get, replay, type State, versionOf } from './replay.ts';

const h = (ms: number, device = 'aaaaaaaa') => formatHlc(ms, 0, device);
const member = (id: string, name: string): Member => ({ id, name });

function batch(batchId: string, members: Member[]): ImportApplyData {
  return {
    batchId,
    importer: { id: 'test', version: 1 },
    file: { name: 'f.xlsx', sha256: 'x', size: 1 },
    puts: members.map((m) => ({ entity: 'member', id: m.id, value: m })),
  };
}

/** A plain object view of state, for comparing two replays. */
function view(state: State) {
  return {
    tables: Object.fromEntries(
      Object.entries(state.tables).map(([k, t]) => [k, [...t.entries()].sort()]),
    ),
    deleted: [...state.deleted.entries()].sort(),
    batches: [...state.batches.entries()].sort(),
    conflicts: [...state.conflicts.entries()].sort(),
    readOnly: state.readOnly,
    head: state.head,
  };
}

describe('replay', () => {
  it('applies puts and deletes in clock order', () => {
    const state = replay([
      putEvent(h(3), 'member', member('m1', 'C')),
      putEvent(h(1), 'member', member('m1', 'A')),
      putEvent(h(2), 'member', member('m2', 'B')),
      deleteEvent(h(4), 'member', 'm2'),
    ]);

    expect(get(state, 'member', 'm1')?.name).toBe('C');
    expect(get(state, 'member', 'm2')).toBeUndefined();
    expect(state.deleted.get('member:m2')).toBe(h(4));
    expect(state.head).toBe(h(4));
  });

  it('lets a later put bring back a deleted record', () => {
    const state = replay([
      putEvent(h(1), 'member', member('m1', 'A')),
      deleteEvent(h(2), 'member', 'm1'),
      putEvent(h(3), 'member', member('m1', 'B')),
    ]);

    expect(get(state, 'member', 'm1')?.name).toBe('B');
    expect(state.deleted.size).toBe(0);
  });

  it('ignores a put whose value id does not match', () => {
    const event = putEvent(h(1), 'member', member('m1', 'A'));

    event.data.id = 'm2';
    expect(all(replay([event]), 'member')).toEqual([]);
  });

  it('records no conflict when the edit saw the current version', () => {
    const state = replay([
      putEvent(h(1), 'member', member('m1', 'A')),
      putEvent(h(2), 'member', member('m1', 'B'), h(1)),
    ]);

    expect(state.conflicts.size).toBe(0);
    expect(versionOf(state, 'member', 'm1')).toBe(h(2));
  });

  it('notes a conflict when two devices edit the same version', () => {
    const state = replay([
      putEvent(h(1), 'member', member('m1', 'A')),
      putEvent(h(2, 'aaaaaaaa'), 'member', member('m1', 'From A'), h(1)),
      putEvent(h(3, 'bbbbbbbb'), 'member', member('m1', 'From B'), h(1)),
    ]);

    expect(get(state, 'member', 'm1')?.name).toBe('From B');
    expect(state.conflicts.get('member:m1')).toEqual({
      entity: 'member',
      id: 'm1',
      winner: { hlc: h(3, 'bbbbbbbb'), value: member('m1', 'From B') },
      loser: { hlc: h(2, 'aaaaaaaa'), value: member('m1', 'From A') },
    });
  });

  it('notes a conflict when an edit meets a delete, and closes it on the next write', () => {
    const events: Event[] = [
      putEvent(h(1), 'member', member('m1', 'A')),
      deleteEvent(h(2, 'aaaaaaaa'), 'member', 'm1', h(1)),
      putEvent(h(3, 'bbbbbbbb'), 'member', member('m1', 'B'), h(1)),
    ];
    const state = replay(events);

    expect(state.conflicts.get('member:m1')?.loser).toEqual({ hlc: h(2, 'aaaaaaaa') });
    const restored = replay([
      ...events,
      putEvent(h(4), 'member', member('m1', 'B'), h(3, 'bbbbbbbb')),
    ]);

    expect(restored.conflicts.size).toBe(0);
  });

  it('applies an import as one batch', () => {
    const state = replay([
      importApplyEvent(h(1), batch('b1', [member('m1', 'A'), member('m2', 'B')])),
    ]);

    expect(all(state, 'member')).toHaveLength(2);
    expect(state.tables.member.get('m1')?.batchId).toBe('b1');
    expect(state.batches.get('b1')?.keys).toEqual(['member:m1', 'member:m2']);
  });

  it('undoes an import, restoring earlier versions and keeping later edits', () => {
    const state = replay([
      putEvent(h(1), 'member', member('m0', 'Before')),
      importApplyEvent(
        h(2),
        batch('b1', [member('m0', 'Imported'), member('m1', 'A'), member('m2', 'B')]),
      ),
      putEvent(h(3), 'member', member('m2', 'Edited'), h(2)),
      importRevertEvent(h(4), 'b1'),
    ]);

    expect(get(state, 'member', 'm0')?.name).toBe('Before');
    expect(get(state, 'member', 'm1')).toBeUndefined();
    expect(get(state, 'member', 'm2')?.name).toBe('Edited');
    expect(state.conflicts.size).toBe(0);
    expect(state.batches.get('b1')).toMatchObject({ reverted: h(4), kept: ['member:m2'] });
  });

  it('goes read-only and skips events of a newer format', () => {
    const newer = { ...putEvent(h(2), 'member', member('m1', 'Z')), v: 99 };
    const state = replay([putEvent(h(1), 'member', member('m1', 'A')), newer]);

    expect(state.readOnly).toBe(true);
    expect(get(state, 'member', 'm1')?.name).toBe('A');
  });

  it('gives the same state for any order or duplication of events', () => {
    const devices = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];
    const ids = ['m1', 'm2', 'm3'];
    const eventArb = fc
      .record({
        ms: fc.integer({ min: 1, max: 40 }),
        device: fc.constantFrom(...devices),
        kind: fc.constantFrom('put', 'delete', 'import', 'revert'),
        id: fc.constantFrom(...ids),
        name: fc.string({ maxLength: 3 }),
        baseMs: fc.option(fc.integer({ min: 1, max: 40 }), { nil: undefined }),
        baseDevice: fc.constantFrom(...devices),
        batch: fc.constantFrom('b1', 'b2'),
      })
      .map((r): Event => {
        const hlc = h(r.ms, r.device);
        const base = r.baseMs === undefined ? undefined : h(r.baseMs, r.baseDevice);

        switch (r.kind) {
          case 'put':
            return putEvent(hlc, 'member', member(r.id, r.name), base);

          case 'delete':
            return deleteEvent(hlc, 'member', r.id, base);

          case 'import':
            return importApplyEvent(hlc, batch(r.batch, [member(r.id, r.name)]));

          default:
            return importRevertEvent(hlc, r.batch);
        }
      });

    fc.assert(
      fc.property(
        fc.uniqueArray(eventArb, { selector: (e) => e.hlc, maxLength: 30 }),
        fc.infiniteStream(fc.nat()),
        (events, rand) => {
          const expected = view(replay(events));
          const shuffled = [...events, ...events.slice(0, 5)];

          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = rand.next().value % (i + 1);

            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }

          expect(view(replay(shuffled))).toEqual(expected);
        },
      ),
    );
  });
});
