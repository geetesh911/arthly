// SPDX-License-Identifier: AGPL-3.0-only
// Fixed deposits, valued from their terms.
import type { AssetType, CashFlow } from '../../../engine/asset-type.ts';
import type { DepositTerms, Instrument } from '../../../model/types.ts';
import { addMonths, daysBetween, type ISODate, maxDate, minDate } from '../../../util/dates.ts';

const PER_YEAR = { monthly: 12, quarterly: 4, 'half-yearly': 2, yearly: 1 } as const;

export function depositTerms(i: Instrument): DepositTerms | undefined {
  return i.terms && 'principal' in i.terms ? i.terms : undefined;
}

/** Cumulative value on a date: full periods compound, a part period earns simple interest. */
export function cumulativeValue(t: DepositTerms, date: ISODate): number {
  const end = minDate(date, t.maturity);

  if (end <= t.start) {
    return t.principal;
  }

  const r = t.ratePct / 100;

  if (t.compounding === 'none') {
    return t.principal * (1 + (r * daysBetween(t.start, end)) / 365);
  }

  const n = PER_YEAR[t.compounding];
  const months = 12 / n;
  let k = 0;

  while (addMonths(t.start, (k + 1) * months) <= end) {
    k += 1;
  }

  const periodStart = addMonths(t.start, k * months);

  return t.principal * (1 + r / n) ** k * (1 + (r * daysBetween(periodStart, end)) / 365);
}

/** Payout dates and amounts for a payout FD. A short last period is paid pro rata at maturity. */
export function payoutSchedule(t: DepositTerms): { date: ISODate; amount: number }[] {
  if (t.payout === 'cumulative') {
    return [];
  }

  const n = PER_YEAR[t.payout];
  const months = 12 / n;
  const r = t.ratePct / 100;
  const out: { date: ISODate; amount: number }[] = [];
  let previous = t.start;

  for (let k = 1; ; k++) {
    const date = addMonths(t.start, k * months);

    if (date > t.maturity) {
      break;
    }

    out.push({ date, amount: (t.principal * r) / n });
    previous = date;
  }

  if (previous < t.maturity) {
    out.push({
      date: t.maturity,
      amount: (t.principal * r * daysBetween(previous, t.maturity)) / 365,
    });
  }

  return out;
}

function maturityAmount(t: DepositTerms): number {
  return t.payout === 'cumulative' ? cumulativeValue(t, t.maturity) : t.principal;
}

function overlapDays(t: DepositTerms, from: ISODate, to: ISODate): number {
  const a = maxDate(from, t.start);
  const b = minDate(to, t.maturity);

  return b > a ? daysBetween(a, b) : 0;
}

export const deposit: AssetType = {
  id: 'deposit',
  kinds: ['fd'],
  value(p, i, ctx) {
    const t = depositTerms(i);

    if (p.matured && p.matured <= ctx.date) {
      return { value: 0, estimate: false, status: 'closed' };
    }

    if (!t) {
      return { value: p.principal + p.credited, estimate: true, status: 'open' };
    }

    if (ctx.date >= t.maturity) {
      return { value: maturityAmount(t), estimate: false, status: 'matured' };
    }

    if (t.payout === 'cumulative') {
      return { value: cumulativeValue(t, ctx.date), estimate: false, status: 'open' };
    }

    const last =
      payoutSchedule(t)
        .filter((x) => x.date <= ctx.date)
        .at(-1)?.date ?? t.start;
    const accrued = (t.principal * (t.ratePct / 100) * daysBetween(last, ctx.date)) / 365;

    return { value: t.principal + accrued, estimate: false, status: 'open' };
  },
  invested(p, i) {
    return p.principal || (depositTerms(i)?.principal ?? 0);
  },
  projected(p, i, from, to) {
    const t = depositTerms(i);

    if (!t) {
      return [];
    }

    const until = p.matured ?? '9999-12-31';
    const flows: CashFlow[] = payoutSchedule(t)
      .filter((x) => x.date > from && x.date <= to && x.date <= until)
      .map((x) => ({ ...x, kind: 'payout', estimated: true }));

    if (!p.matured && t.maturity > from && t.maturity <= to) {
      flows.push({
        date: t.maturity,
        amount: maturityAmount(t),
        kind: 'maturity',
        estimated: true,
      });
    }

    return flows;
  },
  accrued(_p, i, from, to) {
    const t = depositTerms(i);

    if (!t) {
      return 0;
    }

    if (t.payout !== 'cumulative') {
      return (t.principal * (t.ratePct / 100) * overlapDays(t, from, to)) / 365;
    }

    return cumulativeValue(t, maxDate(to, t.start)) - cumulativeValue(t, maxDate(from, t.start));
  },
};
