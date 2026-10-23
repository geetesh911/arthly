// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { inrSigned, pct, points, shortDate } from './format.ts';

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
