// SPDX-License-Identifier: AGPL-3.0-only
// Bond or FD: the same money for the same term, compared by what each pays back and its yearly
// return, before and after tax. The bond's yields follow SEBI's bond yield calculator
// (investor.sebi.gov.in/calc/bond.html): one coupon a year on the par value, and the yield to
// maturity is the rate r where price = coupon × (z + z² + … + z^years) + par × z^years, with
// z = 1 / (1 + r), summed in closed form so years can be a fraction.
//
// SEBI's price leaves out accrued interest, and counts one coupon a year however often the bond
// pays. Between coupons a buyer also pays the seller the coupon rate on par for each day since the
// last one, over 365 days; it comes back in the next coupon, paid in full. Unless the days since
// the last coupon are given, coupons fall in step with maturity, so 2.5 years to go on a yearly
// bond means the last coupon was 6 months ago. The yield on what you pay is the rate of return on
// that total price and every coupon on its date, which is what bond platforms show and what the
// comparison uses. The FD's yearly return is the same kind of rate: what its interest and deposit
// coming back earn, compounded yearly.
import type { Payout } from '../model/types.ts';

import { irr, type TimedFlow } from './xirr.ts';

/** Tax on the gain from redeeming a listed bond held over a year: 12.5% plus 4% cess. */
export const LISTED_BOND_GAIN_TAX_PCT = 13;
export const MAX_YEARS = 50;

/**
 * How a bond held to maturity is taxed. Coupons are taxed at the slab either way.
 * - section-57: Wint Wealth's way. The accrued interest and any premium paid are claimed back
 *   from interest income under Section 57, and a discount is taxed as interest, so the whole gain
 *   is taxed at the slab.
 * - capital-gains: accrued interest is part of the bond's cost, and par less that cost is a
 *   capital gain or loss at maturity.
 */
export type BondTax = 'section-57' | 'capital-gains';

export type CouponFrequency = Exclude<Payout, 'cumulative'>;

export const PER_YEAR: Record<CouponFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  'half-yearly': 2,
  yearly: 1,
};

/** Days in a year for accrued interest. */
const DAYS = 365;

export interface BondInput {
  /** What one bond costs now, without accrued interest. */
  price: number;
  /** What one bond pays back at maturity; coupons are a share of it. */
  par: number;
  couponPct: number;
  years: number;
  /** How often coupons are paid. SEBI's yields count one a year whatever this is. */
  frequency: CouponFrequency;
  /** Null when coupons fall in step with maturity, so the part period left says where we are. */
  daysSinceCoupon: number | null;
}

export interface BondFdInput {
  amount: number;
  /** Income tax on interest and coupons, in percent: your slab plus cess. */
  taxPct: number;
  bondTax: BondTax;
  /** Only the capital gains way taxes a listed bond's gain differently. */
  listed: boolean;
  bond: BondInput;
  /** Interest compounds quarterly when it's added to the FD, as at most banks. */
  fd: { ratePct: number; payout: Payout };
}

export interface ReturnSummary {
  invested: number;
  /** Everything that comes back: interest or coupons, then the deposit or par value. */
  received: number;
  gain: number;
  tax: number;
  /** Yearly return as a fraction, before and after tax. */
  yield: number | null;
  yieldAfterTax: number | null;
}

export interface BondYields {
  /** A year's coupon over the price, as SEBI works it out. */
  currentYield: number;
  /** SEBI's yield to maturity, on the price without accrued interest. */
  ytm: number | null;
  /** As given, or worked out from the part period left to maturity. */
  daysSinceCoupon: number;
  /** Interest earned since the last coupon, which a buyer pays the seller. */
  accrued: number;
  /** The price plus accrued interest: what one bond costs to buy. */
  totalPrice: number;
  /** The yield on the total price, with each coupon on its date. */
  yieldOnPaid: number | null;
}

export interface BondFdComparison {
  /** Whole bonds the amount buys at their total price; the FD gets what they cost. */
  units: number;
  /** The accrued interest paid for all of them. */
  accrued: number;
  bond: ReturnSummary;
  fd: ReturnSummary;
  /** The FD rate, paid the same way, that would match the bond after tax. */
  matchingFdRatePct: number | null;
}

const between = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
const positive = (n: number) => Number.isFinite(n) && n > 0;

/** Why SEBI's calculator can't work out this bond, or null when it can. */
export function bondProblem(b: BondInput): string | null {
  if (!positive(b.price)) {
    return 'Enter the bond’s current price.';
  }

  if (!positive(b.par)) {
    return 'Enter the bond’s par value.';
  }

  if (!between(b.couponPct, 0, 100)) {
    return 'The coupon rate must be from 0 to 100%.';
  }

  if (!positive(b.years) || b.years > MAX_YEARS) {
    return `Years to maturity must be above 0 and at most ${MAX_YEARS}.`;
  }

  const most = Math.floor(DAYS / PER_YEAR[b.frequency]);

  if (b.daysSinceCoupon !== null && !between(b.daysSinceCoupon, 0, most)) {
    return `Days since the last coupon must be from 0 to ${most} for ${b.frequency} coupons.`;
  }

  return null;
}

/** Why the bond and FD can't be compared, or null when they can. */
export function bondFdProblem(input: BondFdInput): string | null {
  const { amount, taxPct, bond, fd } = input;
  const problem = bondProblem(bond);

  if (problem) {
    return problem;
  }

  if (!positive(amount)) {
    return 'Enter the amount to invest.';
  }

  if (amount < bondYields(bond).totalPrice) {
    return 'The amount must cover at least one bond at its total price.';
  }

  if (!between(taxPct, 0, 100)) {
    return 'Tax must be from 0 to 100%.';
  }

  if (!between(fd.ratePct, 0, 100)) {
    return 'The FD’s interest rate must be from 0 to 100% a year.';
  }

  return null;
}

/** SEBI's price at a yield: one coupon a year, then `redemption` at maturity. */
function priceAt(rate: number, coupon: number, redemption: number, years: number): number {
  const z = 1 / (1 + rate);
  const coupons = Math.abs(1 - z) < 1e-12 ? years : (z * (1 - z ** years)) / (1 - z);

  return coupon * coupons + redemption * z ** years;
}

/** The yield where SEBI's price meets `price`, or null when there's none. */
function yieldAt(price: number, coupon: number, redemption: number, years: number) {
  // The price falls as the yield rises, so halve the range around it.
  const above = (rate: number) => priceAt(rate, coupon, redemption, years) > price;
  let lo = -0.99;
  let hi = 1;

  if (!above(lo)) {
    return null;
  }

  while (above(hi)) {
    hi *= 2;

    if (hi > 1e6) {
      return null;
    }
  }

  while (hi - lo > 1e-12) {
    const mid = (lo + hi) / 2;

    if (above(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

const total = (flows: TimedFlow[]) => flows.reduce((sum, f) => sum + f.amount, 0);
const negate = (flows: TimedFlow[]) => flows.map((f) => ({ ...f, amount: -f.amount }));

/** Years since the last coupon: as given, or the part period left to maturity. */
function sinceCoupon(b: BondInput): number {
  if (b.daysSinceCoupon !== null) {
    return b.daysSinceCoupon / DAYS;
  }

  const n = PER_YEAR[b.frequency];
  const periods = b.years * n;

  // A whole number of periods to go is a coupon date.
  return Math.max(0, Math.ceil(periods - 1e-9) - periods) / n;
}

/** One bond's coupons on their dates: in full each period, and pro rata for a short last one. */
function couponFlows(b: BondInput): TimedFlow[] {
  const n = PER_YEAR[b.frequency];
  const coupon = (b.par * b.couponPct) / 100;
  const since = sinceCoupon(b);
  const flows: TimedFlow[] = [];
  let last = -since;

  for (let k = 1; k / n - since < b.years - 1e-9; k++) {
    last = k / n - since;
    flows.push({ years: last, amount: coupon / n });
  }

  // In step with maturity this is a full coupon; otherwise what's earned since the one before.
  flows.push({ years: b.years, amount: coupon * (b.years - last) });

  return flows;
}

/** SEBI's yields, the accrued interest a buyer pays, and the yield on what's paid. */
export function bondYields(b: BondInput): BondYields {
  const coupon = (b.par * b.couponPct) / 100;
  const since = sinceCoupon(b);
  // Paid to the paisa, as the price with it is quoted.
  const accrued = Math.round(coupon * since * 100) / 100;
  const totalPrice = b.price + accrued;

  return {
    currentYield: coupon / b.price,
    ytm: yieldAt(b.price, coupon, b.par, b.years),
    daysSinceCoupon: since * DAYS,
    accrued,
    totalPrice,
    yieldOnPaid: irr([
      { years: 0, amount: -totalPrice },
      ...couponFlows(b),
      { years: b.years, amount: b.par },
    ]),
  };
}

function bondReturn(input: BondFdInput, units: number): ReturnSummary {
  const { taxPct, bondTax, listed, bond } = input;
  const { accrued, totalPrice, yieldOnPaid } = bondYields(bond);
  const coupons = couponFlows(bond);
  const slab = (amount: number) => (amount * taxPct) / 100;
  // For one bond: each coupon, then par.
  const back = [...coupons, { years: bond.years, amount: bond.par }];
  const taxes = coupons.map((c) => ({ years: c.years, amount: slab(c.amount) }));

  if (bondTax === 'section-57') {
    // The accrued interest comes back in the first coupon, so it's claimed against that one.
    // A premium is claimed, and a discount taxed as interest, when par comes back.
    taxes[0]!.amount -= slab(accrued);
    taxes.push({ years: bond.years, amount: slab(bond.par - bond.price) });
  } else {
    const gainPct = listed && bond.years > 1 ? Math.min(taxPct, LISTED_BOND_GAIN_TAX_PCT) : taxPct;
    // A capital loss only offsets other capital gains, so it isn't counted as saving tax.
    const gain = Math.max(0, bond.par - totalPrice);

    taxes.push({ years: bond.years, amount: (gain * gainPct) / 100 });
  }

  const paidIn = { years: 0, amount: -totalPrice };

  return {
    invested: units * totalPrice,
    received: units * total(back),
    gain: units * (total(back) - totalPrice),
    tax: units * total(taxes),
    yield: yieldOnPaid,
    yieldAfterTax: irr([paidIn, ...back, ...negate(taxes)]),
  };
}

/** An FD's value after `years` with interest added: full quarters compound, a part quarter doesn't. */
function cumulativeAt(amount: number, rate: number, years: number): number {
  const quarters = Math.floor(years * 4 + 1e-9);

  return amount * (1 + rate / 4) ** quarters * (1 + rate * (years - quarters / 4));
}

function fdReturn(input: BondFdInput, invested: number, ratePct: number): ReturnSummary {
  const { taxPct, fd } = input;
  const { years } = input.bond;
  const rate = ratePct / 100;
  /** Interest as it's earned, which is when it's taxed. */
  const interest: TimedFlow[] = [];
  let back: TimedFlow[];

  if (fd.payout === 'cumulative') {
    // Interest added to the FD comes back at maturity, but is taxed each year as it's earned.
    for (let k = 1, before = invested; ; k++) {
      const at = Math.min(k, years);
      const value = cumulativeAt(invested, rate, at);

      interest.push({ years: at, amount: value - before });
      before = value;

      if (at === years) {
        break;
      }
    }

    back = [{ years, amount: invested + total(interest) }];
  } else {
    // Paid out simple, with a short last period paid pro rata at maturity.
    const n = PER_YEAR[fd.payout];
    const full = Math.floor(years * n + 1e-9);

    for (let k = 1; k <= full; k++) {
      interest.push({ years: k / n, amount: (invested * rate) / n });
    }

    if (full / n < years) {
      interest.push({ years, amount: invested * rate * (years - full / n) });
    }

    back = [...interest, { years, amount: invested }];
  }

  const taxes = interest.map((i) => ({ years: i.years, amount: (i.amount * taxPct) / 100 }));
  const paidIn = { years: 0, amount: -invested };
  const received = total(back);

  return {
    invested,
    received,
    gain: received - invested,
    tax: total(taxes),
    yield: irr([paidIn, ...back]),
    yieldAfterTax: irr([paidIn, ...back, ...negate(taxes)]),
  };
}

/** The FD rate whose after-tax return matches `target`, to a hundredth of a percent. */
function matchingRate(input: BondFdInput, invested: number, target: number | null) {
  const after = (ratePct: number) => fdReturn(input, invested, ratePct).yieldAfterTax ?? -1;
  let lo = 0;
  let hi = 100;

  if (target === null || after(lo) > target || after(hi) < target) {
    return null;
  }

  while (hi - lo > 1e-4) {
    const mid = (lo + hi) / 2;

    if (after(mid) < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return Math.round(((lo + hi) / 2) * 100) / 100;
}

export function compareBondFd(input: BondFdInput): BondFdComparison {
  const { accrued, totalPrice } = bondYields(input.bond);
  const units = Math.floor(input.amount / totalPrice + 1e-9);
  const bond = bondReturn(input, units);

  return {
    units,
    accrued: units * accrued,
    bond,
    fd: fdReturn(input, bond.invested, input.fd.ratePct),
    matchingFdRatePct: matchingRate(input, bond.invested, bond.yieldAfterTax),
  };
}
