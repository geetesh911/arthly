// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';

import { hideAmounts } from './amounts.ts';
import {
  dateTime,
  inr,
  inrShort,
  inrSigned,
  masked,
  pct,
  points,
  shortDate,
  typed,
} from './format.ts';

describe('pct', () => {
  it('shows a fraction as a percentage with 2 decimals', () => {
    expect(pct(0.0789)).toBe('7.89%');
    expect(pct(0.5, 0)).toBe('50%');
    expect(pct(-0.125)).toBe('-12.50%');
    expect(pct(null)).toBe('—');
  });

  it('adds a + to gains when asked', () => {
    expect(pct(0.105, 2, true)).toBe('+10.50%');
    expect(pct(-0.105, 2, true)).toBe('-10.50%');
    expect(pct(0, 2, true)).toBe('0.00%');
  });

  it('never shows -0.00%', () => {
    expect(pct(-0.00001)).toBe('0.00%');
    expect(pct(-0.00001, 2, true)).toBe('0.00%');
  });
});

describe('inrSigned', () => {
  it('signs gains and losses but not zero', () => {
    expect(inrSigned(47051.4)).toBe('+₹47,051');
    expect(inrSigned(-1234)).toBe('-₹1,234');
    expect(inrSigned(-0.3)).toBe('₹0');
  });
});

describe('hidden amounts', () => {
  afterEach(() => hideAmounts(false));

  it('shows each amount as ₹•••• and keeps its sign', () => {
    hideAmounts(true);
    expect(inr(123456)).toBe('₹••••');
    expect(inrSigned(47051.4)).toBe('+₹••••');
    expect(inrSigned(-1234)).toBe('-₹••••');
    expect(inrShort(1_23_00_000)).toBe('₹••••');
    expect(inr(null)).toBe('—');
  });

  it('hides amounts inside text too', () => {
    hideAmounts(true);
    expect(masked('deposit at least ₹500 (₹1,200.50 so far)')).toBe(
      'deposit at least ₹•••• (₹•••• so far)',
    );
  });

  it('leaves percentages and typed-in amounts', () => {
    hideAmounts(true);
    expect(pct(0.0789)).toBe('7.89%');
    expect(typed.inr(1000)).toBe('₹1,000');
  });

  it('shows amounts again', () => {
    hideAmounts(true);
    hideAmounts(false);
    expect(inr(123456)).toBe('₹1,23,456');
  });
});

describe('points', () => {
  it('shows a gap in percentage points, signed, never -0.0', () => {
    expect(points(0.032)).toBe('+3.2 pts');
    expect(points(-0.1)).toBe('-10.0 pts');
    expect(points(-0.0004)).toBe('0.0 pts');
    expect(points(NaN)).toBe('—');
  });
});

describe('shortDate', () => {
  it('leaves out the year only when it is this year', () => {
    const now = new Date('2026-10-22T12:00:00Z');

    expect(shortDate('2026-10-21', now)).toBe('21 Oct');
    expect(shortDate('2025-12-31', now)).toBe('31 Dec 2025');
  });
});

describe('dateTime', () => {
  it('shows the day and time in local time, without the year', () => {
    const at = new Date(2026, 9, 24, 10, 42);

    expect(dateTime(at.toISOString())).toMatch(/^24 Oct(,| at) 10:42\s?am$/i);
  });
});
