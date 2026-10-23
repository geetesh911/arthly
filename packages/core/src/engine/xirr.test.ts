// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { xirr } from './xirr.ts';

describe('xirr', () => {
  it("matches Excel's documented example", () => {
    const r = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ]);
    expect(r).toBeCloseTo(0.373362535, 6);
  });

  it('matches simple one-year cases', () => {
    expect(
      xirr([
        { date: '2021-01-01', amount: -1000 },
        { date: '2022-01-01', amount: 1100 },
      ]),
    ).toBeCloseTo(0.1, 8);
    // 366 days in a leap year: Excel gives 1.1^(365/366) − 1.
    expect(
      xirr([
        { date: '2020-01-01', amount: -1000 },
        { date: '2021-01-01', amount: 1100 },
      ]),
    ).toBeCloseTo(1.1 ** (365 / 366) - 1, 8);
  });

  it('handles monthly SIPs', () => {
    const flows = Array.from({ length: 12 }, (_, m) => ({
      date: `2025-${String(m + 1).padStart(2, '0')}-05`,
      amount: -5000,
    }));
    flows.push({ date: '2026-01-05', amount: 66000 });
    const r = xirr(flows)!;
    expect(r).toBeGreaterThan(0.17);
    expect(r).toBeLessThan(0.2);
  });

  it('handles losses close to -100%', () => {
    const r = xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1 },
    ]);
    expect(r).toBeCloseTo(-0.999, 3);
  });

  it('returns null when there is no sign change', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000 }])).toBeNull();
    expect(
      xirr([
        { date: '2025-01-01', amount: 1000 },
        { date: '2025-02-01', amount: 5 },
      ]),
    ).toBeNull();
    expect(xirr([])).toBeNull();
  });
});
