// SPDX-License-Identifier: AGPL-3.0-only
// Credit cards: what's left to pay on each card's latest bill counts against net worth, but not in
// invested, gain or XIRR, which stay about investments. A new bill replaces whatever was left on
// the last one, since the bank's new bill already includes it.
import { all, get, type State } from '../log/replay.ts';
import type { Card, CardBill, CardPayment, ISODate } from '../model/types.ts';
import { addDays, isISODate } from '../util/dates.ts';

import { amountProblem, loansApply } from './loans.ts';
import type { Filter } from './portfolio.ts';

/** Half a paisa: anything left within this of zero is paid. */
export const CARD_EPS = 0.005;

export type BillState = 'paid' | 'minimum' | 'part' | 'unpaid';

export const BILL_STATE_LABELS: Record<BillState, string> = {
  paid: 'Paid',
  minimum: 'Minimum paid',
  part: 'Part paid',
  unpaid: 'Unpaid',
};

export interface BillStatus {
  bill: CardBill;
  /** Payments after its statement date, up to the next bill's statement date or the date. */
  paid: number;
  /** Below zero when more was paid than the bill. */
  left: number;
  state: BillState;
  /** Only the latest bill can be overdue: a new bill takes over what was left. */
  overdue: boolean;
}

export interface CardStatus {
  card: Card;
  /** Every bill, newest first. */
  bills: BillStatus[];
  /** Every payment, newest first. */
  payments: CardPayment[];
  /** The bill with the latest statement date on or before the date. */
  latest?: BillStatus;
  /** What's left to pay on the latest bill, never below zero. */
  due: number;
  /** What was paid beyond the latest bill. */
  credit: number;
  overdue: boolean;
  /** The latest bill as a share of the limit. */
  limitUsed: number | null;
}

const byStatement = (a: CardBill, b: CardBill) => a.statementDate.localeCompare(b.statementDate);
const byDate = (a: CardPayment, b: CardPayment) => a.date.localeCompare(b.date);

function billState(bill: CardBill, paid: number): BillState {
  if (paid >= bill.amount - CARD_EPS) {
    return 'paid';
  }

  if (paid > CARD_EPS) {
    return paid >= bill.minimumDue - CARD_EPS ? 'minimum' : 'part';
  }

  return 'unpaid';
}

function statusOf(
  card: Card,
  bills: CardBill[],
  payments: CardPayment[],
  date: ISODate,
): CardStatus {
  const oldest = [...bills].sort(byStatement);
  const counted = payments.filter((p) => p.date <= date);
  const statuses = oldest.map((bill, i): BillStatus => {
    const next = oldest[i + 1]?.statementDate;
    // A payment on a statement date is already in that bill, so it counts toward the one before.
    const paid = counted
      .filter((p) => p.date > bill.statementDate && (!next || p.date <= next))
      .reduce((n, p) => n + p.amount, 0);

    return { bill, paid, left: bill.amount - paid, state: billState(bill, paid), overdue: false };
  });
  const latest = statuses.findLast((s) => s.bill.statementDate <= date);

  if (latest) {
    latest.overdue = latest.bill.dueDate < date && latest.left > CARD_EPS;
  }

  const left = latest?.left ?? 0;

  return {
    card,
    bills: statuses.reverse(),
    payments: [...payments].sort(byDate).reverse(),
    ...(latest ? { latest } : {}),
    due: left > CARD_EPS ? left : 0,
    credit: left < -CARD_EPS ? -left : 0,
    overdue: latest?.overdue ?? false,
    limitUsed: latest && card.limit ? latest.bill.amount / card.limit : null,
  };
}

const billsOf = (state: State, cardId: string) =>
  all(state, 'cardBill').filter((b) => b.cardId === cardId);
const paymentsOf = (state: State, cardId: string) =>
  all(state, 'cardPayment').filter((p) => p.cardId === cardId);

/** Cards follow the loans rule: they belong to a member, and to no account, group or class. */
export function cardStatuses(state: State, date: ISODate, filter?: Filter): CardStatus[] {
  if (!loansApply(filter)) {
    return [];
  }

  const bills = new Map<string, CardBill[]>();
  const payments = new Map<string, CardPayment[]>();

  for (const b of all(state, 'cardBill')) {
    (bills.get(b.cardId) ?? bills.set(b.cardId, []).get(b.cardId)!).push(b);
  }

  for (const p of all(state, 'cardPayment')) {
    (payments.get(p.cardId) ?? payments.set(p.cardId, []).get(p.cardId)!).push(p);
  }

  return all(state, 'card')
    .filter((card) => !filter?.memberId || card.memberId === filter.memberId)
    .map((card) => statusOf(card, bills.get(card.id) ?? [], payments.get(card.id) ?? [], date));
}

/** Left to pay over every card, closed ones too, so a due can't hide. */
export function cardDues(statuses: CardStatus[]): number {
  return statuses.reduce((n, s) => n + s.due, 0);
}

/**
 * Latest bills with something left to pay that fall due from `from` to `days` later, and any
 * overdue ones, which come first.
 */
export function cardsDue(
  statuses: CardStatus[],
  from: ISODate,
  days: number,
): { date: ISODate; card: Card; amount: number; overdue: boolean }[] {
  const to = addDays(from, days);

  return statuses
    .filter((s) => s.latest && s.due > 0 && s.latest.bill.dueDate <= to)
    .map((s) => ({ date: s.latest!.bill.dueDate, card: s.card, amount: s.due, overdue: s.overdue }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Why a card's details can't be saved, if they can't. A card is closed on `card.closed`. */
export function cardProblem(state: State, card: Card): string | undefined {
  if (!card.bank.trim()) {
    return 'Type the bank';
  }

  if (!card.name.trim()) {
    return 'Type a name for the card';
  }

  if (!get(state, 'member', card.memberId)) {
    return 'Choose whose card this is';
  }

  if (card.limit !== undefined && !(Number.isFinite(card.limit) && card.limit > 0)) {
    return 'Enter a limit above zero, or leave it blank';
  }

  if (card.closed && !get(state, 'card', card.id)?.closed) {
    const s = statusOf(card, billsOf(state, card.id), paymentsOf(state, card.id), card.closed);

    if (s.due > 0) {
      return 'Pay what’s left before closing the card';
    }
  }

  return undefined;
}

/** Why a bill's amounts and dates don't make sense, if they don't. */
export function billFiguresProblem(
  bill: Pick<CardBill, 'statementDate' | 'dueDate' | 'amount' | 'minimumDue'>,
): string | undefined {
  if (!isISODate(bill.statementDate)) {
    return 'Enter the statement date';
  }

  if (!isISODate(bill.dueDate)) {
    return 'Enter the due date';
  }

  if (!(Number.isFinite(bill.amount) && bill.amount >= 0)) {
    return 'Enter the bill’s amount, or 0';
  }

  if (!(Number.isFinite(bill.minimumDue) && bill.minimumDue >= 0)) {
    return 'Enter the minimum due, or 0';
  }

  if (bill.minimumDue > bill.amount + CARD_EPS) {
    return 'The minimum due can’t be more than the bill';
  }

  if (bill.dueDate <= bill.statementDate) {
    return 'The due date must be after the statement date';
  }

  return undefined;
}

/** Why a bill can't be added (or replace the one with its ID), if it can't. */
export function billProblem(state: State, bill: CardBill): string | undefined {
  const bad = billFiguresProblem(bill);

  if (bad) {
    return bad;
  }

  if (!get(state, 'card', bill.cardId)) {
    return 'This card no longer exists';
  }

  if (
    billsOf(state, bill.cardId).some(
      (b) => b.id !== bill.id && b.statementDate === bill.statementDate,
    )
  ) {
    return `There’s already a bill dated ${bill.statementDate}`;
  }

  return undefined;
}

/** Why a payment can't be added (or replace the one with its ID), if it can't. */
export function paymentProblem(state: State, payment: CardPayment): string | undefined {
  const bad = amountProblem(payment.amount);

  if (bad) {
    return bad;
  }

  if (!get(state, 'card', payment.cardId)) {
    return 'This card no longer exists';
  }

  const first = billsOf(state, payment.cardId).sort(byStatement)[0]?.statementDate;

  if (!first) {
    return 'Add the bill first';
  }

  if (payment.date <= first) {
    return `A payment must be after the first bill’s statement date, ${first}`;
  }

  return undefined;
}
