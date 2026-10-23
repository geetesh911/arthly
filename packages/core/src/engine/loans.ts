// SPDX-License-Identifier: AGPL-3.0-only
// Loans: money owed to you (lent) and money you owe (borrowed). They count in net worth, but not
// in invested, gain or XIRR, which stay about investments.
import { all, get, type State } from '../log/replay.ts';
import type { ISODate, Loan, LoanEntry, LoanEntryType } from '../model/types.ts';
import { addDays } from '../util/dates.ts';

import type { Filter } from './portfolio.ts';

/** Half a paisa: a balance within this of zero is settled. */
export const LOAN_EPS = 0.005;

export interface LoanStatus {
  loan: Loan;
  /** Every entry, oldest first. The amounts below count those on or before the date. */
  entries: LoanEntry[];
  advanced: number;
  repaid: number;
  writtenOff: number;
  /** Below zero when more was paid back than lent. */
  balance: number;
  open: boolean;
  /** The first advance. */
  start?: ISODate;
  /** The last entry's date, once nothing is owed. */
  settled?: ISODate;
  overdue: boolean;
}

/** Open balances only, in INR. */
export interface LoanTotals {
  owedToYou: number;
  youOwe: number;
  owedToYouByMember: Record<string, number>;
}

export const NO_LOANS: LoanTotals = { owedToYou: 0, youOwe: 0, owedToYouByMember: {} };

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
// Entries come in the order they were recorded, and the sort is stable, so a day's entries stay
// in that order.
const byDate = (a: LoanEntry, b: LoanEntry) => a.date.localeCompare(b.date);

/** What is still owed after these entries, whatever their dates. */
export const outstanding = (entries: LoanEntry[]) =>
  entries.reduce((n, e) => n + (e.type === 'advance' ? e.amount : -e.amount), 0);

/** Loans belong to a member, but not to an account, a group or an asset class. */
export function loansApply(filter?: Filter): boolean {
  return !filter?.accountId && !filter?.instrumentId && !filter?.groupId && !filter?.assetClass;
}

function entriesOf(state: State, loanId: string): LoanEntry[] {
  return all(state, 'loanEntry')
    .filter((e) => e.loanId === loanId)
    .sort(byDate);
}

export function loanStatuses(state: State, date: ISODate, filter?: Filter): LoanStatus[] {
  if (!loansApply(filter)) {
    return [];
  }

  const entries = new Map<string, LoanEntry[]>();

  for (const e of all(state, 'loanEntry')) {
    (entries.get(e.loanId) ?? entries.set(e.loanId, []).get(e.loanId)!).push(e);
  }

  return all(state, 'loan')
    .filter((loan) => !filter?.memberId || loan.memberId === filter.memberId)
    .map((loan) => {
      const list = (entries.get(loan.id) ?? []).sort(byDate);
      const counted = list.filter((e) => e.date <= date);
      const sum = (type: LoanEntryType) =>
        counted.filter((e) => e.type === type).reduce((n, e) => n + e.amount, 0);
      const advanced = sum('advance');
      const repaid = sum('repayment');
      const writtenOff = sum('write-off');
      const balance = advanced - repaid - writtenOff;
      const open = balance > LOAN_EPS;
      const start = list.find((e) => e.type === 'advance')?.date;

      return {
        loan,
        entries: list,
        advanced,
        repaid,
        writtenOff,
        balance,
        open,
        ...(start ? { start } : {}),
        ...(!open && counted.length ? { settled: counted.at(-1)!.date } : {}),
        overdue: open && !!loan.due && loan.due < date,
      };
    });
}

export function loanTotals(statuses: LoanStatus[]): LoanTotals {
  const totals: LoanTotals = { owedToYou: 0, youOwe: 0, owedToYouByMember: {} };

  for (const s of statuses) {
    if (!s.open) {
      continue;
    }

    if (s.loan.direction === 'lent') {
      totals.owedToYou += s.balance;
      totals.owedToYouByMember[s.loan.memberId] =
        (totals.owedToYouByMember[s.loan.memberId] ?? 0) + s.balance;
    } else {
      totals.youOwe += s.balance;
    }
  }

  return totals;
}

/** Open loans due from `from` to `days` later, soonest first. */
export function loansDue(
  statuses: LoanStatus[],
  from: ISODate,
  days: number,
): { date: ISODate; loan: Loan; amount: number }[] {
  const to = addDays(from, days);

  return statuses
    .filter((s) => s.open && s.loan.due && s.loan.due >= from && s.loan.due <= to)
    .map((s) => ({ date: s.loan.due!, loan: s.loan, amount: s.balance }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Amounts are always above zero; the entry type gives the direction. */
export function amountProblem(amount: number): string | undefined {
  return Number.isFinite(amount) && amount > 0 ? undefined : 'Enter an amount above zero';
}

/**
 * Why a loan's details can't be saved, if they can't. `start` is the first advance's date, for a
 * loan whose entries aren't saved yet.
 */
export function loanProblem(state: State, loan: Loan, start?: ISODate): string | undefined {
  if (!loan.party.trim()) {
    return 'Type who the loan is with';
  }

  if (!get(state, 'member', loan.memberId)) {
    return 'Choose whose loan this is';
  }

  const first = start ?? entriesOf(state, loan.id).find((e) => e.type === 'advance')?.date;

  if (loan.due && first && loan.due < first) {
    return `The due date is before the loan started on ${first}`;
  }

  return undefined;
}

/** Why an entry can't be added (or replace the one with its ID), if it can't. */
export function loanEntryProblem(state: State, entry: LoanEntry): string | undefined {
  const bad = amountProblem(entry.amount);

  if (bad) {
    return bad;
  }

  if (!get(state, 'loan', entry.loanId)) {
    return 'This loan no longer exists';
  }

  if (entry.type === 'advance') {
    return undefined;
  }

  const others = entriesOf(state, entry.loanId).filter((e) => e.id !== entry.id);
  const start = others.find((e) => e.type === 'advance')?.date;

  if (start && entry.date < start) {
    return `A payment can’t be before the loan started on ${start}`;
  }

  const owed = outstanding(others);

  if (entry.amount > owed + LOAN_EPS) {
    return `That’s more than the ${inr(Math.max(0, owed))} still owed`;
  }

  return undefined;
}

/** Why an entry can't be deleted, if it can't. */
export function entryRemovalProblem(state: State, entryId: string): string | undefined {
  const entry = get(state, 'loanEntry', entryId);

  if (!entry) {
    return undefined;
  }

  const rest = entriesOf(state, entry.loanId).filter((e) => e.id !== entryId);

  return outstanding(rest) < -LOAN_EPS
    ? 'That would leave more paid back than lent. Delete a payment first.'
    : undefined;
}
