// SPDX-License-Identifier: AGPL-3.0-only
// Hybrid logical clock: `<13-digit ms>.<4-digit counter>.<deviceId>`.
// Sorting the strings gives a total order across devices.

const MAX_COUNTER = 9999;
const HLC = /^(\d{13})\.(\d{4})\.([a-z2-7]+)$/;

export interface Clock {
  readonly deviceId: string;
  /** A new timestamp, later than every one made or observed so far. */
  next(): string;
  /** Moves the clock past a timestamp seen from another device. */
  observe(hlc: string): void;
}

export function parseHlc(hlc: string): { ms: number; counter: number; deviceId: string } {
  const m = HLC.exec(hlc);
  if (!m) throw new Error(`Not a clock value: ${hlc}`);
  return { ms: Number(m[1]), counter: Number(m[2]), deviceId: m[3]! };
}

export function isHlc(text: string): boolean {
  return HLC.test(text);
}

export function formatHlc(ms: number, counter: number, deviceId: string): string {
  return `${String(ms).padStart(13, '0')}.${String(counter).padStart(4, '0')}.${deviceId}`;
}

export function createClock(
  deviceId: string,
  options: { now?: () => number; last?: string } = {},
): Clock {
  const now = options.now ?? Date.now;
  let ms = 0;
  let counter = 0;

  function observe(hlc: string): void {
    const seen = parseHlc(hlc);
    if (seen.ms > ms || (seen.ms === ms && seen.counter > counter)) {
      ms = seen.ms;
      counter = seen.counter;
    }
  }

  if (options.last) observe(options.last);

  return {
    deviceId,
    observe,
    next() {
      const wall = now();
      if (wall > ms) {
        ms = wall;
        counter = 0;
      } else if (counter < MAX_COUNTER) {
        counter += 1;
      } else {
        ms += 1;
        counter = 0;
      }
      return formatHlc(ms, counter, deviceId);
    },
  };
}
