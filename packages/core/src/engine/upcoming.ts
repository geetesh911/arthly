// SPDX-License-Identifier: AGPL-3.0-only
// What's coming up: payouts, coupons, interest credits, maturities and the PPF deadline.
import { get, type State } from '../log/replay.ts';
import { assetTypeFor } from '../plugins/assets/index.ts';
import { addDays, fyEnd, fyOf, fyStart, type ISODate } from '../util/dates.ts';

import type { CashFlowKind } from './asset-type.ts';
import { assetContext, engineCache, type EngineOptions } from './portfolio.ts';
import { positions } from './positions.ts';
import type { PriceBook } from './prices.ts';
import { DEFAULT_RATES } from './rates.ts';

export interface Upcoming {
  date: ISODate;
  kind: CashFlowKind | 'ppf-deadline';
  accountId: string;
  instrumentId: string;
  amount?: number;
  estimated: boolean;
}

export function upcoming(
  state: State,
  book: PriceBook,
  from: ISODate,
  days: number,
  options: EngineOptions = {},
): Upcoming[] {
  const rates = options.rates ?? DEFAULT_RATES;
  const cache = options.cache ?? engineCache(state);
  const to = addDays(from, days);
  const ctx = assetContext(book, from, rates, cache);
  const out: Upcoming[] = [];

  for (const p of positions(state, from, book, cache.ledgers)) {
    const i = get(state, 'instrument', p.instrumentId)!;
    const type = assetTypeFor(i.kind);
    const v = type.value(p, i, ctx);

    if (v.status === 'closed') {
      continue;
    }

    for (const f of type.projected?.(p, i, from, to, ctx) ?? []) {
      out.push({
        date: f.date,
        kind: f.kind,
        accountId: p.accountId,
        instrumentId: p.instrumentId,
        amount: f.amount,
        estimated: f.estimated,
      });
    }

    if (i.kind === 'ppf') {
      for (let fy = fyOf(from); fyEnd(fy) <= to; fy++) {
        if (fyEnd(fy) < from) {
          continue;
        }

        const deposited = p.entries
          .filter((e) => e.type === 'contribution' && e.date >= fyStart(fy) && e.date <= fyEnd(fy))
          .reduce((s, e) => s + e.amount, 0);

        out.push({
          date: fyEnd(fy),
          kind: 'ppf-deadline',
          accountId: p.accountId,
          instrumentId: p.instrumentId,
          amount: Math.max(0, 500 - deposited),
          estimated: false,
        });
      }
    }
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
