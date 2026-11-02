// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { type AverageNavInput, averageNavProblem, newAverageNav } from './average-nav.ts';

/** 100 units at an average of ₹50, and 100 more at ₹40. */
const input = (over: Partial<AverageNavInput> = {}): AverageNavInput => ({
  averageNav: 50,
  held: { by: 'units', value: 100 },
  nav: 40,
  buy: { by: 'units', value: 100 },
  ...over,
});

describe('newAverageNav', () => {
  it('brings the average down when buying below it', () => {
    const r = newAverageNav(input());

    expect(r.heldCost).toBe(5000);
    expect(r.boughtCost).toBe(4000);
    expect(r.units).toBe(200);
    expect(r.cost).toBe(9000);
    expect(r.averageNav).toBe(45);
    expect(r.change).toBeCloseTo(-0.1, 12);
    // Down 20% at ₹40 before, and 11.11% after.
    expect(r.returnBefore).toBeCloseTo(-0.2, 12);
    expect(r.returnAfter).toBeCloseTo(40 / 45 - 1, 12);
  });

  it('takes either side as the money it cost', () => {
    const r = newAverageNav(
      input({ held: { by: 'amount', value: 5000 }, buy: { by: 'amount', value: 4000 } }),
    );

    expect(r.heldUnits).toBe(100);
    expect(r.boughtUnits).toBe(100);
    expect(r.averageNav).toBe(45);
  });

  it('mixes units held with an amount to invest', () => {
    // ₹10,000 at ₹125.5 buys 79.681 units.
    const r = newAverageNav({
      averageNav: 142.3456,
      held: { by: 'units', value: 352.817 },
      nav: 125.5,
      buy: { by: 'amount', value: 10_000 },
    });

    // ₹50,221.95 plus ₹10,000, over 432.498 units.
    expect(r.boughtUnits).toBeCloseTo(79.681275, 6);
    expect(r.units).toBeCloseTo(432.498275, 6);
    expect(r.cost).toBeCloseTo(60_221.95, 2);
    expect(r.averageNav).toBeCloseTo(139.2421, 4);
  });

  it('brings the average up when buying above it', () => {
    const r = newAverageNav(input({ averageNav: 100, nav: 120, buy: { by: 'units', value: 100 } }));

    expect(r.averageNav).toBe(110);
    expect(r.change).toBeCloseTo(0.1, 12);
    expect(r.returnBefore).toBeCloseTo(0.2, 12);
  });

  it.each([
    ['buying nothing', input({ buy: { by: 'units', value: 0 } })],
    ['buying at the average', input({ nav: 50 })],
  ])('leaves the average where it is when %s', (_, i) => {
    const r = newAverageNav(i);

    expect(r.averageNav).toBe(50);
    expect(r.change).toBe(0);
  });
});

describe('averageNavProblem', () => {
  it('accepts a full input, and buying nothing', () => {
    expect(averageNavProblem(input())).toBeNull();
    expect(averageNavProblem(input({ buy: { by: 'amount', value: 0 } }))).toBeNull();
  });

  it.each([
    [{ averageNav: Number.NaN }, 'Enter your average NAV.'],
    [{ averageNav: 0 }, 'Enter your average NAV.'],
    [{ held: { by: 'units', value: Number.NaN } }, 'Enter the units you hold.'],
    [{ held: { by: 'amount', value: 0 } }, 'Enter the amount you invested.'],
    [{ nav: -1 }, 'Enter the NAV you’re buying at.'],
    [{ buy: { by: 'units', value: Number.NaN } }, 'Enter the units to buy.'],
    [{ buy: { by: 'amount', value: -500 } }, 'Enter the amount to invest.'],
  ] as [Partial<AverageNavInput>, string][])('asks for what is missing: %o', (over, message) => {
    expect(averageNavProblem(input(over))).toBe(message);
  });
});
