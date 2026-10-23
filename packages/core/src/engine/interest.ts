// SPDX-License-Identifier: AGPL-3.0-only
// Month-by-month interest for balance accounts (PPF, EPF), credited once a year on 31 March.
import {
  addMonths,
  day,
  endOfMonth,
  fyOf,
  type ISODate,
  makeDate,
  month,
  year,
} from '../util/dates.ts';

import type { Entry } from './positions.ts';

export interface InterestRule {
  /** PPF: lowest balance from the 5th to month end. EPF: balance at the end of the month before. */
  base: 'min-from-5th' | 'previous-month-end';
  /** Annual rate in percent for the month starting on this date. */
  ratePct(monthStart: ISODate): number;
}

export interface Credit {
  fy: number;
  date: ISODate;
  amount: number;
  estimated: boolean;
}

export interface InterestResult {
  balance: number;
  /** Interest earned in the current financial year and not credited yet. */
  accrued: number;
  months: { month: ISODate; interest: number }[];
  credits: Credit[];
  closed: boolean;
}

/** The financial year an interest credit belongs to; early-April credits count for the year before. */
export function creditFy(e: Entry): number {
  const fy = Number(e.meta?.fy);

  if (Number.isInteger(fy) && fy > 1900) {
    return fy;
  }

  return month(e.date) === 4 && day(e.date) <= 15 ? fyOf(e.date) - 1 : fyOf(e.date);
}

function signed(e: Entry): number {
  switch (e.type) {
    case 'opening':
    case 'buy':
    case 'switch-in':
    case 'contribution':
    case 'interest':
      return e.amount;

    case 'withdrawal':
    case 'sell':
    case 'switch-out':
    case 'tax':
    case 'charge':
      return -e.amount;

    default:
      return 0;
  }
}

export function simulateInterest(
  entries: readonly Entry[],
  upTo: ISODate,
  rule: InterestRule,
): InterestResult {
  const result: InterestResult = { balance: 0, accrued: 0, months: [], credits: [], closed: false };
  const live = entries.filter((e) => e.date <= upTo);

  if (live.length === 0) {
    return result;
  }

  const realFys = new Set(live.filter((e) => e.type === 'interest' && !e.synthetic).map(creditFy));
  let balance = 0;
  let fyInterest = 0;
  let index = 0;
  let start = makeDate(year(live[0]!.date), month(live[0]!.date), 1);

  while (start <= upTo) {
    const end = endOfMonth(start);
    const before = balance;
    let lowest: number | null = null;

    while (index < live.length && live[index]!.date <= end) {
      const e = live[index]!;

      if (day(e.date) > 5 && lowest === null) {
        lowest = balance;
      }

      if (e.type === 'maturity') {
        balance = 0;
        result.closed = true;
      } else {
        balance += signed(e);

        if (e.type === 'interest' && !e.synthetic) {
          result.credits.push({
            fy: creditFy(e),
            date: e.date,
            amount: e.amount,
            estimated: false,
          });
        }
      }

      if (day(e.date) > 5) {
        lowest = Math.min(lowest!, balance);
      }

      index += 1;
    }

    if (end > upTo || result.closed) {
      break;
    }

    const base = rule.base === 'min-from-5th' ? Math.min(lowest ?? balance, balance) : before;
    const interest = (Math.max(0, base) * rule.ratePct(start)) / 1200;

    fyInterest += interest;
    result.months.push({ month: start, interest });

    if (month(end) === 3) {
      const fy = fyOf(end);

      if (!realFys.has(fy) && fyInterest > 0) {
        balance += fyInterest;
        result.credits.push({ fy, date: end, amount: fyInterest, estimated: true });
      }

      fyInterest = 0;
    }

    start = addMonths(start, 1);
  }

  result.balance = balance;
  result.accrued = result.closed ? 0 : fyInterest;

  return result;
}

/** Interest earned in months that end inside (from, to]. */
export function interestBetween(result: InterestResult, from: ISODate, to: ISODate): number {
  return result.months
    .filter((m) => endOfMonth(m.month) > from && endOfMonth(m.month) <= to)
    .reduce((sum, m) => sum + m.interest, 0);
}
