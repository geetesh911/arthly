// SPDX-License-Identifier: AGPL-3.0-only
// EPF: monthly interest on last month's closing balance at the year's declared rate,
// credited each 31 March. Interest credited in the passbook replaces the estimate.
import type { AssetContext, AssetType, CashFlow } from '../../../engine/asset-type.ts';
import { interestBetween, simulateInterest } from '../../../engine/interest.ts';
import type { Position } from '../../../engine/positions.ts';
import { epfRate } from '../../../engine/rates.ts';
import { fyOf, type ISODate } from '../../../util/dates.ts';

const run = (p: Position, ctx: AssetContext, upTo: ISODate) =>
  simulateInterest(p.entries, upTo, {
    base: 'previous-month-end',
    ratePct: (m) => epfRate(ctx.rates, fyOf(m)).ratePct,
  });

export const epf: AssetType = {
  id: 'epf',
  kinds: ['epf'],
  value(p, _i, ctx) {
    const r = run(p, ctx, ctx.date);

    if (r.closed) {
      return { value: 0, estimate: false, status: 'closed' };
    }

    const estimated = r.accrued > 0 || r.credits.some((c) => c.estimated);

    return {
      value: r.balance + r.accrued,
      estimate: estimated,
      status: 'open',
      balance: r.balance,
    };
  },
  invested: (p) => p.principal,
  projected(p, _i, from, to, ctx) {
    return run(p, ctx, to)
      .credits.filter((c) => c.date > from && c.date <= to)
      .map((c): CashFlow => ({
        date: c.date,
        amount: c.amount,
        kind: 'credit',
        estimated: c.estimated,
      }));
  },
  accrued(p, _i, from, to, ctx) {
    return interestBetween(run(p, ctx, to), from, to);
  },
};
