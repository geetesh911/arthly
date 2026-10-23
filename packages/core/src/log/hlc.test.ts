// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { createClock, parseHlc } from './hlc.ts';

describe('clock', () => {
  it('formats as ms.counter.device', () => {
    const clock = createClock('abcdefgh', { now: () => 1_760_000_000_000 });

    expect(clock.next()).toBe('1760000000000.0000.abcdefgh');
    expect(clock.next()).toBe('1760000000000.0001.abcdefgh');
  });

  it('never goes backwards when the wall clock does', () => {
    let wall = 2_000;
    const clock = createClock('aaaaaaaa', { now: () => wall });
    const first = clock.next();

    wall = 1_000;
    const second = clock.next();

    expect(second > first).toBe(true);
  });

  it('rolls into the next millisecond when the counter is full', () => {
    const clock = createClock('aaaaaaaa', { now: () => 5, last: '0000000000005.9999.bbbbbbbb' });

    expect(clock.next()).toBe('0000000000006.0000.aaaaaaaa');
  });

  it('moves past timestamps seen from other devices', () => {
    const clock = createClock('aaaaaaaa', { now: () => 10 });

    clock.observe('0000000000500.0003.bbbbbbbb');
    const next = clock.next();

    expect(next > '0000000000500.0003.bbbbbbbb').toBe(true);
    expect(parseHlc(next)).toEqual({ ms: 500, counter: 4, deviceId: 'aaaaaaaa' });
  });

  it('rejects malformed values', () => {
    expect(() => parseHlc('12.3.x')).toThrow();
  });
});
