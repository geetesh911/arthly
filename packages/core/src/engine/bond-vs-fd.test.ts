// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  type BondFdInput,
  bondFdProblem,
  type BondInput,
  bondProblem,
  bondYields,
  compareBondFd,
} from './bond-vs-fd.ts';
import { irr, type TimedFlow } from './xirr.ts';

const bond = (over: Partial<BondInput> = {}): BondInput => ({
  price: 1000,
  par: 1000,
  couponPct: 8.5,
  years: 3,
  frequency: 'yearly',
  daysSinceCoupon: null,
  ...over,
});

const input = (over: Partial<BondFdInput> = {}): BondFdInput => ({
  amount: 100_000,
  taxPct: 0,
  bondTax: 'section-57',
  listed: true,
  bond: bond(),
  fd: { ratePct: 7, payout: 'cumulative' },
  ...over,
});

/** A bond 2.5 years from maturity: the next coupon is 6 months away. */
const between = bond({ price: 980, couponPct: 7.5, years: 2.5 });

/** One bond's flows, less `taxes` at the same times. */
const flows = (paid: number, back: [number, number][], taxes: [number, number][] = []) =>
  [
    { years: 0, amount: -paid },
    ...back.map(([years, amount]) => ({ years, amount })),
    ...taxes.map(([years, amount]) => ({ years, amount: -amount })),
  ] satisfies TimedFlow[];

describe('bondYields', () => {
  // Worked out on investor.sebi.gov.in/calc/bond.html, which shows 3 decimals.
  it.each([
    [950, 1000, 8, 5, 8.421, 9.295328],
    [1050, 1000, 9, 3, 8.571, 7.091554],
    [1000, 1000, 8.5, 3, 8.5, 8.500002],
    [980, 1000, 7.5, 2.5, 7.653, 8.420264],
    [900, 1000, 0, 4, 0, 2.66901],
    [101.5, 100, 7.25, 7, 7.143, 6.971943],
    [1200, 1000, 5, 10, 4.167, 2.692085],
    [990, 1000, 8.5, 1, 8.586, 9.59596],
  ])(
    'matches SEBI for %d with par %d, %d%% coupon and %d years',
    (price, par, couponPct, years, current, ytm) => {
      const y = bondYields(bond({ price, par, couponPct, years }));

      expect(y.currentYield * 100).toBeCloseTo(current, 3);
      expect(y.ytm! * 100).toBeCloseTo(ytm, 3);
    },
  );

  it('has no accrued interest on a whole number of years, and the yield is SEBI’s', () => {
    const y = bondYields(bond({ price: 950, couponPct: 8, years: 5 }));

    expect(y.accrued).toBe(0);
    expect(y.totalPrice).toBe(950);
    expect(y.yieldOnPaid).toBeCloseTo(y.ytm!, 9);
  });

  it('adds the coupon earned since the last one, and yields on the total price', () => {
    const y = bondYields(between);

    expect(y.accrued).toBeCloseTo(37.5, 9);
    expect(y.totalPrice).toBeCloseTo(1017.5, 9);
    expect(y.yieldOnPaid).toBeCloseTo(
      irr(
        flows(1017.5, [
          [0.5, 75],
          [1.5, 75],
          [2.5, 1075],
        ]),
      )!,
      9,
    );
  });

  it('counts most of a coupon as accrued close to the next one', () => {
    expect(bondYields(bond({ couponPct: 8, years: 0.25 })).accrued).toBeCloseTo(60, 9);
  });

  it('keeps SEBI’s yield on yearly coupons, and yields monthly ones as they come', () => {
    const y = bondYields(bond({ frequency: 'monthly' }));

    expect(y.accrued).toBe(0);
    expect(y.ytm).toBeCloseTo(0.085, 9);
    expect(y.yieldOnPaid).toBeCloseTo((1 + 0.085 / 12) ** 12 - 1, 9);
  });

  it('works out accrued interest from the part period left on a monthly bond', () => {
    const y = bondYields(bond({ couponPct: 12, years: 1 + 1 / 24, frequency: 'monthly' }));

    expect(y.daysSinceCoupon).toBeCloseTo(365 / 24, 9);
    expect(y.accrued).toBe(5);
  });

  it('takes the days since the last coupon, with a short last coupon pro rata', () => {
    // 73 days is a fifth of a year, so the coupon a year on is 0.8 years away.
    const y = bondYields(bond({ couponPct: 8, years: 1.5, daysSinceCoupon: 73 }));

    expect(y.accrued).toBe(16);
    expect(y.yieldOnPaid).toBeCloseTo(
      irr(
        flows(1016, [
          [0.8, 80],
          [1.5, 56 + 1000],
        ]),
      )!,
      9,
    );
  });

  it('matches Wint Wealth on a monthly Navi Finserv bond', () => {
    // 10.3% NCD maturing 31 Oct 2028, bought 27 Oct 2026 at ₹9,966.80 clean, 11 days after a
    // coupon. Wint shows ₹31.04 accrued, ₹9,997.84 dirty and an 11% yield.
    const navi = bond({
      price: 9966.8,
      par: 10_000,
      couponPct: 10.3,
      years: 735 / 365,
      frequency: 'monthly',
      daysSinceCoupon: 11,
    });
    const y = bondYields(navi);
    const r = compareBondFd(input({ amount: 99_978.41, bond: navi }));

    expect(y.accrued).toBe(31.04);
    expect(y.totalPrice).toBeCloseTo(9997.84, 9);
    expect(y.yieldOnPaid).toBeCloseTo(0.11, 4);
    // Wint's investment amount for 10 buys 10, though it rounds accrued interest on all of them.
    expect(r.units).toBe(10);
  });
});

describe('compareBondFd', () => {
  it('buys whole bonds at their total price and puts what they cost in the FD', () => {
    const r = compareBondFd(input({ bond: between }));

    expect(r.units).toBe(98);
    expect(r.accrued).toBeCloseTo(98 * 37.5, 6);
    expect(r.bond.invested).toBeCloseTo(99_715, 6);
    expect(r.fd.invested).toBeCloseTo(99_715, 6);
    // The accrued interest comes back in the first coupon, so the gain is the same as without it.
    expect(r.bond.received).toBeCloseTo(98 * (75 * 3 + 1000), 6);
    expect(r.bond.gain).toBeCloseTo(98 * (75 * 2.5 + 20), 6);
  });

  it('gives a bond bought at par its coupon rate', () => {
    const r = compareBondFd(input());

    expect(r.bond.received).toBeCloseTo(125_500, 6);
    expect(r.bond.yield).toBeCloseTo(0.085, 9);
  });

  it('compounds interest added to an FD quarterly', () => {
    const { fd } = compareBondFd(input());

    expect(fd.received).toBeCloseTo(100_000 * 1.0175 ** 12, 6);
    expect(fd.yield).toBeCloseTo(1.0175 ** 4 - 1, 9);
    expect(fd.tax).toBe(0);
  });

  it('pays FD interest out with a short last period pro rata', () => {
    const { fd } = compareBondFd(
      input({ bond: bond({ years: 1.25 }), fd: { ratePct: 8, payout: 'half-yearly' } }),
    );

    expect(fd.gain).toBeCloseTo(fd.invested * 0.08 * 1.25, 6);
  });

  it('taxes each FD payout at the slab as it comes', () => {
    const { fd } = compareBondFd(
      input({ taxPct: 30, bond: bond({ years: 2 }), fd: { ratePct: 8, payout: 'yearly' } }),
    );

    expect(fd.tax).toBeCloseTo(4_800, 6);
    expect(fd.yieldAfterTax).toBeCloseTo(0.056, 9);
  });

  it('taxes interest added to an FD each year, not at maturity', () => {
    const { fd } = compareBondFd(input({ taxPct: 30 }));
    const atMaturity = (1 + (fd.gain * 0.7) / 100_000) ** (1 / 3) - 1;

    expect(fd.tax).toBeCloseTo(fd.gain * 0.3, 6);
    expect(fd.yieldAfterTax!).toBeLessThan(atMaturity);
  });

  describe('Wint’s way (Section 57)', () => {
    it('claims accrued interest back against the first coupon', () => {
      const { bond: b } = compareBondFd(input({ taxPct: 31.2, bond: between }));

      expect(b.tax).toBeCloseTo(98 * 0.312 * (75 * 2.5 + 20), 6);
      expect(b.yieldAfterTax).toBeCloseTo(
        irr(
          flows(
            1017.5,
            [
              [0.5, 75],
              [1.5, 75],
              [2.5, 1075],
            ],
            [
              [0.5, 0.312 * (75 - 37.5)],
              [1.5, 0.312 * 75],
              [2.5, 0.312 * (75 + 20)],
            ],
          ),
        )!,
        9,
      );
    });

    it('taxes a discount from the seller as interest at the slab', () => {
      const { bond: b } = compareBondFd(
        input({ taxPct: 31.2, bond: bond({ price: 950, couponPct: 8, years: 5 }) }),
      );

      expect(b.tax).toBeCloseTo(105 * 0.312 * (80 * 5 + 50), 6);
      expect(b.yieldAfterTax).toBeCloseTo(
        irr(
          flows(
            950,
            [1, 2, 3, 4, 5].map((t) => [t, 80 + (t === 5 ? 1000 : 0)]),
            [1, 2, 3, 4, 5].map((t) => [t, 0.312 * (80 + (t === 5 ? 50 : 0))]),
          ),
        )!,
        9,
      );
    });

    it('claims a premium back against interest', () => {
      const { bond: b } = compareBondFd(
        input({ taxPct: 30, bond: bond({ price: 1050, couponPct: 9 }) }),
      );

      expect(b.tax).toBeCloseTo(95 * 0.3 * (90 * 3 - 50), 6);
    });
  });

  describe('the capital gains way', () => {
    const gains = (over: Partial<BondFdInput>) =>
      compareBondFd(input({ bondTax: 'capital-gains', taxPct: 31.2, ...over })).bond;

    it('taxes a listed bond’s discount at 12.5% plus cess, and an unlisted one’s at the slab', () => {
      const discount = bond({ price: 950, couponPct: 8, years: 5 });
      const listed = gains({ bond: discount });
      const unlisted = gains({ bond: discount, listed: false });
      const coupons = [1, 2, 3, 4, 5].map((t): [number, number] => [t, 80 + (t === 5 ? 1000 : 0)]);
      const couponTax = [1, 2, 3, 4, 5].map((t): [number, number] => [t, 80 * 0.312]);

      expect(listed.tax).toBeCloseTo(105 * (80 * 5 * 0.312 + 50 * 0.13), 6);
      expect(unlisted.tax).toBeCloseTo(105 * (80 * 5 + 50) * 0.312, 6);
      expect(listed.yieldAfterTax).toBeCloseTo(
        irr(flows(950, coupons, [...couponTax, [5, 50 * 0.13]]))!,
        9,
      );
    });

    it('taxes the discount at the slab on a listed bond held a year or less', () => {
      expect(gains({ bond: bond({ price: 990, years: 1 }) }).tax).toBeCloseTo(
        101 * (85 + 10) * 0.312,
        6,
      );
    });

    it('counts accrued interest as cost, so only the discount beyond it is a gain', () => {
      const discount = gains({ bond: bond({ price: 950, couponPct: 8, years: 4.5 }) });

      // 40 accrued on 950 is a cost of 990, so 10 of gain on each of 101 bonds.
      expect(discount.tax).toBeCloseTo(101 * (80 * 5 * 0.312 + 10 * 0.13), 6);
      // A cost above par is a loss, which isn't counted as saving tax.
      expect(gains({ bond: between }).tax).toBeCloseTo(98 * 75 * 3 * 0.312, 6);
    });

    it('counts no tax saved on a loss from a bond bought above par', () => {
      const b = gains({ taxPct: 30, bond: bond({ price: 1050, couponPct: 9 }) });

      expect(b.tax).toBeCloseTo(95 * 90 * 3 * 0.3, 6);
      expect(b.yield!).toBeLessThan(0.09);
    });
  });

  it('finds the FD rate that matches the bond after tax', () => {
    const same = compareBondFd(
      input({ taxPct: 30, bond: bond({ couponPct: 8 }), fd: { ratePct: 7, payout: 'yearly' } }),
    );
    // Quarterly compounding needs a lower rate to match 8% paid once a year.
    const quarterly = compareBondFd(input({ bond: bond({ couponPct: 8 }) }));

    expect(same.matchingFdRatePct).toBe(8);
    expect(quarterly.matchingFdRatePct).toBeCloseTo(400 * (1.08 ** 0.25 - 1), 2);
  });
});

describe('bondFdProblem', () => {
  it('accepts a sound input', () => {
    expect(bondFdProblem(input())).toBeNull();
    expect(bondProblem(bond({ couponPct: 0, years: 0.5 }))).toBeNull();
  });

  it.each([
    [{ bond: bond({ price: 0 }) }, 'Enter the bond’s current price.'],
    [{ bond: bond({ par: Number.NaN }) }, 'Enter the bond’s par value.'],
    [{ bond: bond({ couponPct: -1 }) }, 'The coupon rate must be from 0 to 100%.'],
    [{ bond: bond({ years: 0 }) }, 'Years to maturity must be above 0 and at most 50.'],
    [
      { bond: bond({ frequency: 'monthly', daysSinceCoupon: 31 }) },
      'Days since the last coupon must be from 0 to 30 for monthly coupons.',
    ],
    [
      { bond: bond({ daysSinceCoupon: -1 }) },
      'Days since the last coupon must be from 0 to 365 for yearly coupons.',
    ],
    [{ amount: 0 }, 'Enter the amount to invest.'],
    [{ amount: 999 }, 'The amount must cover at least one bond at its total price.'],
    // 1000 covers the price of 980 but not the 37.50 of accrued interest on top.
    [
      { amount: 1000, bond: between },
      'The amount must cover at least one bond at its total price.',
    ],
    [{ taxPct: 101 }, 'Tax must be from 0 to 100%.'],
    [
      { fd: { ratePct: Number.NaN, payout: 'cumulative' } },
      'The FD’s interest rate must be from 0 to 100% a year.',
    ],
  ] as [Partial<BondFdInput>, string][])('rejects %o', (over, message) => {
    expect(bondFdProblem(input(over))).toBe(message);
  });
});
