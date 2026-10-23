// SPDX-License-Identifier: AGPL-3.0-only
// Interest and dividends per financial year: a summary, not tax advice.
import { get, type State } from '../log/replay.ts';
import { assetTypeFor } from '../plugins/assets/index.ts';
import { addDays, fyEnd, fyStart } from '../util/dates.ts';
import { engineCache, assetContext, type EngineOptions } from './portfolio.ts';
import { interestPaidOut, positions } from './positions.ts';
import type { PriceBook } from './prices.ts';
import { DEFAULT_RATES } from './rates.ts';

export interface IncomeRow {
  fy: number;
  memberId: string;
  accountId: string;
  instrumentId: string;
  type: 'interest' | 'dividend';
  /** Paid out or credited during the year. */
  received: number;
  /** Earned during the year, whether paid or not. */
  accrued: number;
  /** Tax deducted at source. */
  tds: number;
  taxFree: boolean;
  /** Some figures are worked out from terms or rates rather than recorded. */
  estimated: boolean;
}

export function income(
  state: State,
  book: PriceBook,
  fy: number,
  options: EngineOptions = {},
): IncomeRow[] {
  const rates = options.rates ?? DEFAULT_RATES;
  const cache = options.cache ?? engineCache(state);
  const from = fyStart(fy);
  const to = fyEnd(fy);
  const before = addDays(from, -1);
  const ctx = assetContext(book, to, rates, cache);
  const rows: IncomeRow[] = [];
  for (const p of positions(state, to, book, cache.ledgers)) {
    const i = get(state, 'instrument', p.instrumentId)!;
    const memberId = get(state, 'account', p.accountId)!.memberId;
    const type = assetTypeFor(i.kind);
    const inYear = p.entries.filter((e) => e.date >= from && e.date <= to && !e.synthetic);
    const base = { fy, memberId, accountId: p.accountId, instrumentId: p.instrumentId };

    const dividends = inYear.filter((e) => e.type === 'dividend' || e.type === 'dividend-reinvest');
    if (dividends.length) {
      const amount = dividends.reduce((s, e) => s + e.amount, 0);
      rows.push({
        ...base,
        type: 'dividend',
        received: amount,
        accrued: amount,
        tds: 0,
        taxFree: false,
        estimated: false,
      });
    }

    let received = inYear.filter((e) => e.type === 'interest').reduce((s, e) => s + e.amount, 0);
    let estimated = false;
    const projected = type.projected?.(p, i, before, to, ctx) ?? [];
    if (i.kind === 'ppf' || i.kind === 'epf') {
      const credits = projected.filter((f) => f.kind === 'credit');
      received = credits.reduce((s, f) => s + f.amount, 0);
      estimated = credits.some((f) => f.estimated);
    } else if (interestPaidOut(i) && !p.hasInterest) {
      const assumed = projected.filter((f) => f.kind === 'payout' || f.kind === 'coupon');
      received += assumed.reduce((s, f) => s + f.amount, 0);
      estimated = assumed.length > 0;
    }
    const accrued = type.accrued?.(p, i, before, to, ctx) ?? 0;
    const tds = inYear.filter((e) => e.type === 'tax').reduce((s, e) => s + e.amount, 0);
    if (received > 0.005 || accrued > 0.005 || tds > 0) {
      rows.push({
        ...base,
        type: 'interest',
        received,
        accrued,
        tds,
        taxFree: i.kind === 'ppf',
        estimated: estimated || (accrued > 0 && !p.hasInterest),
      });
    }
  }
  return rows;
}
