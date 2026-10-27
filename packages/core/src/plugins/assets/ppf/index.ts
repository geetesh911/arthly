// SPDX-License-Identifier: AGPL-3.0-only
// PPF: monthly interest on the lowest balance from the 5th, credited each 31 March. The value counts
// only interest a statement shows; the estimates are for Income and Upcoming.
import type { AssetContext, AssetType, CashFlow } from '../../../engine/asset-type.ts';
import { interestBetween, simulateInterest } from '../../../engine/interest.ts';
import type { Position } from '../../../engine/positions.ts';
import { ppfRate } from '../../../engine/rates.ts';
import type { Instrument } from '../../../model/types.ts';
import { fyEnd, fyOf, type ISODate } from '../../../util/dates.ts';

const run = (p: Position, ctx: AssetContext, upTo: ISODate) =>
  simulateInterest(p.entries, upTo, {
    base: 'min-from-5th',
    ratePct: (m) => ppfRate(ctx.rates, m),
  });

/** 15 years from the end of the financial year the account was opened. */
export function ppfMaturity(p: Position, i: Instrument): ISODate | undefined {
  const opened = i.terms && 'opened' in i.terms ? i.terms.opened : p.entries[0]?.date;

  return opened ? fyEnd(fyOf(opened) + 15) : undefined;
}

export const ppf: AssetType = {
  id: 'ppf',
  kinds: ['ppf'],
  value(p, _i, ctx) {
    const r = run(p, ctx, ctx.date);

    if (r.closed) {
      return { value: 0, estimate: false, status: 'closed' };
    }

    // Only interest the passbook shows: none earned since 31 March, nor any for a year not in yet.
    return { value: r.received, estimate: false, status: 'open', balance: r.received };
  },
  invested: (p) => p.principal,
  projected(p, i, from, to, ctx) {
    const r = run(p, ctx, to);
    const flows: CashFlow[] = r.credits
      .filter((c) => c.date > from && c.date <= to)
      .map((c) => ({ date: c.date, amount: c.amount, kind: 'credit', estimated: c.estimated }));
    const maturity = ppfMaturity(p, i);

    if (maturity && maturity > from && maturity <= to && !r.closed) {
      flows.push({ date: maturity, amount: r.balance, kind: 'maturity', estimated: true });
    }

    return flows;
  },
  accrued(p, _i, from, to, ctx) {
    return interestBetween(run(p, ctx, to), from, to);
  },
};
