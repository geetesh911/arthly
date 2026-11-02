// SPDX-License-Identifier: AGPL-3.0-only
// Average NAV: what buying more of a fund at a NAV does to the average NAV of what you hold. The
// average is what all the units cost over how many there are, so buying below it brings it down
// and buying above it brings it up. Each side can be given as units or as the money they cost:
// the units are the money over the NAV, and the money is the units times the NAV. It works the
// same for a stock's average price. Stamp duty and other charges are left out.

/** Whether a side is given as units, or as the money they cost. */
export type SizedBy = 'units' | 'amount';

export interface AverageNavInput {
  /** What each unit held cost, on average. */
  averageNav: number;
  held: { by: SizedBy; value: number };
  /** The NAV the new units are bought at. */
  nav: number;
  buy: { by: SizedBy; value: number };
}

export interface AverageNavResult {
  heldUnits: number;
  /** What the units held cost. */
  heldCost: number;
  boughtUnits: number;
  boughtCost: number;
  /** All the units after buying, and what they cost together. */
  units: number;
  cost: number;
  averageNav: number;
  /** How far the average moved, as a fraction of the old one. */
  change: number;
  /** The return on what you hold at the buying NAV, as a fraction, before and after buying. */
  returnBefore: number;
  returnAfter: number;
}

const positive = (n: number) => Number.isFinite(n) && n > 0;

/** Why the new average can't be worked out, or null when it can. */
export function averageNavProblem(i: AverageNavInput): string | null {
  if (!positive(i.averageNav)) {
    return 'Enter your average NAV.';
  }

  if (!positive(i.held.value)) {
    return i.held.by === 'units' ? 'Enter the units you hold.' : 'Enter the amount you invested.';
  }

  if (!positive(i.nav)) {
    return 'Enter the NAV you’re buying at.';
  }

  // Buying nothing is allowed: the average stays where it is.
  if (!Number.isFinite(i.buy.value) || i.buy.value < 0) {
    return i.buy.by === 'units' ? 'Enter the units to buy.' : 'Enter the amount to invest.';
  }

  return null;
}

/** Units and what they cost, from either one at a NAV. */
const lot = (side: AverageNavInput['held'], nav: number) =>
  side.by === 'units'
    ? { units: side.value, cost: side.value * nav }
    : { units: side.value / nav, cost: side.value };

/** The average NAV after buying. Check averageNavProblem first. */
export function newAverageNav(i: AverageNavInput): AverageNavResult {
  const held = lot(i.held, i.averageNav);
  const bought = lot(i.buy, i.nav);
  const units = held.units + bought.units;
  const cost = held.cost + bought.cost;
  const averageNav = cost / units;

  return {
    heldUnits: held.units,
    heldCost: held.cost,
    boughtUnits: bought.units,
    boughtCost: bought.cost,
    units,
    cost,
    averageNav,
    change: averageNav / i.averageNav - 1,
    returnBefore: i.nav / i.averageNav - 1,
    returnAfter: i.nav / averageNav - 1,
  };
}
