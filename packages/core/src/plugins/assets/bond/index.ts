// SPDX-License-Identifier: AGPL-3.0-only
// Bonds and SGBs: market price if listed, else face value plus accrued coupon.
import type { AssetType, CashFlow } from '../../../engine/asset-type.ts';
import { unitsOn } from '../../../engine/positions.ts';
import type { BondTerms, Instrument } from '../../../model/types.ts';
import { addMonths, daysBetween, type ISODate, maxDate, minDate } from '../../../util/dates.ts';

export function bondTerms(i: Instrument): BondTerms | undefined {
  return i.terms && 'faceValue' in i.terms ? i.terms : undefined;
}

export function couponDates(t: BondTerms): ISODate[] {
  const months = 12 / t.couponFreq;
  const out: ISODate[] = [];

  for (let k = 1; ; k++) {
    const date = addMonths(t.issue, k * months);

    if (date > t.maturity) {
      break;
    }

    out.push(date);
  }

  return out;
}

const couponPerUnit = (t: BondTerms) => (t.faceValue * t.couponPct) / 100 / t.couponFreq;

export const bond: AssetType = {
  id: 'bond',
  kinds: ['bond', 'sgb'],
  value(p, i, ctx) {
    if (p.matured && p.matured <= ctx.date) {
      return { value: 0, estimate: false, status: 'closed' };
    }

    if (p.units <= 1e-9) {
      return { value: 0, estimate: false, status: 'closed' };
    }

    const t = bondTerms(i);
    const status = t && ctx.date >= t.maturity ? 'matured' : 'open';
    const price = ctx.prices.price(i, ctx.date);

    if (price) {
      return { value: p.units * price.price, priceDate: price.date, estimate: false, status };
    }

    if (!t) {
      return { value: p.cost, estimate: true, status };
    }

    if (status === 'matured') {
      return { value: p.units * t.faceValue, estimate: true, status };
    }

    const last =
      couponDates(t)
        .filter((d) => d <= ctx.date)
        .at(-1) ?? t.issue;
    const accrued = (t.faceValue * (t.couponPct / 100) * daysBetween(last, ctx.date)) / 365;

    return { value: p.units * (t.faceValue + accrued), estimate: true, status };
  },
  invested: (p) => p.cost,
  projected(p, i, from, to) {
    const t = bondTerms(i);

    if (!t) {
      return [];
    }

    // Past coupons use the units held then; future ones the units held now.
    const held = (date: ISODate) =>
      date <= (p.entries.at(-1)?.date ?? date) ? unitsOn(p.entries, date) : p.units;
    const flows: CashFlow[] = couponDates(t)
      .filter((d) => d > from && d <= to)
      .map((date): CashFlow => ({
        date,
        amount: held(date) * couponPerUnit(t),
        kind: 'coupon',
        estimated: true,
      }))
      .filter((f) => f.amount > 0);

    if (!p.matured && p.units > 1e-9 && t.maturity > from && t.maturity <= to) {
      flows.push({
        date: t.maturity,
        amount: p.units * t.faceValue,
        kind: 'maturity',
        estimated: true,
      });
    }

    return flows;
  },
  accrued(p, i, from, to) {
    const t = bondTerms(i);

    if (!t) {
      return 0;
    }

    const a = maxDate(from, t.issue);
    const b = minDate(to, t.maturity);

    return b > a ? (p.units * t.faceValue * (t.couponPct / 100) * daysBetween(a, b)) / 365 : 0;
  },
};
