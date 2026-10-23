// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { base32Decode, base32Encode } from './base32.ts';
import { fromBase64, toBase64 } from './bytes.ts';
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  fyEnd,
  fyLabel,
  fyOf,
  fyStart,
  isISODate,
} from './dates.ts';
import { roundAmount, roundUnits, valueTolerance } from './numbers.ts';

describe('base32', () => {
  it('round trips any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
      }),
    );
  });
  it('encodes 20 bytes as 32 characters', () => {
    expect(base32Encode(new Uint8Array(20))).toHaveLength(32);
  });
  it('ignores dashes, spaces and case when decoding', () => {
    const code = base32Encode(new Uint8Array([1, 2, 3, 4, 5]));

    expect(base32Decode(code.toUpperCase().replace(/(.{4})/g, '$1- '))).toEqual(
      new Uint8Array([1, 2, 3, 4, 5]),
    );
  });
});

describe('base64', () => {
  it('round trips', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(fromBase64(toBase64(bytes))).toEqual(bytes);
      }),
    );
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('26-01-01')).toBe(false);
  });
  it('adds months with month-end clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('counts days', () => {
    expect(daysBetween('2026-09-02', '2027-09-02')).toBe(365);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });
  it('knows financial years', () => {
    expect(fyOf('2026-03-31')).toBe(2025);
    expect(fyOf('2026-04-01')).toBe(2026);
    expect(fyStart(2026)).toBe('2026-04-01');
    expect(fyEnd(2026)).toBe('2027-03-31');
    expect(fyLabel(2026)).toBe('2026-27');
    expect(fyLabel(2099)).toBe('2099-00');
  });
});

describe('numbers', () => {
  it('rounds amounts and units', () => {
    expect(roundAmount(1.005)).toBe(1.01);
    expect(roundAmount(-1.005)).toBe(-1.01);
    expect(roundUnits(1.23456789)).toBe(1.234568);
  });
  it('uses max(₹100, 0.05%) as value tolerance', () => {
    expect(valueTolerance(10_000)).toBe(100);
    expect(valueTolerance(1_000_000)).toBe(500);
  });
});
