// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { portfolioAnalytics } from './analytics.ts';
import {
  billProblem,
  cardDues,
  cardProblem,
  cardsDue,
  cardStatuses,
  paymentProblem,
} from './cards.ts';
import { checks } from './checks.ts';
import { summary } from './portfolio.ts';
import { PriceBook } from './prices.ts';
import { Ledger } from './testkit.ts';

/** A March bill of 12,000 (minimum 600) due 5 Apr, and 600 paid on 20 Mar. */
const card = () =>
  new Ledger()
    .member('mem_1', 'Asha')
    .member('mem_2', 'Ravi')
    .card({ id: 'card_1', limit: 100_000 })
    .bill('card_1', '2026-03-15', '2026-04-05', 12_000, 600)
    .payment('card_1', 600, '2026-03-20');

const statusOn = (ledger: Ledger, date: string) => cardStatuses(ledger.state(), date)[0]!;

describe('card dues', () => {
  it('takes payments since the statement date off the latest bill', () => {
    const s = statusOn(card(), '2026-04-01');

    expect(s.latest).toMatchObject({ paid: 600, left: 11_400, state: 'minimum', overdue: false });
    expect(s).toMatchObject({ due: 11_400, credit: 0, overdue: false, limitUsed: 0.12 });
  });

  it('tells part paid, minimum paid, paid and unpaid apart', () => {
    const state = (amount?: number) => {
      const ledger = new Ledger().member().card({ id: 'card_1' });

      ledger.bill('card_1', '2026-03-15', '2026-04-05', 12_000, 600);

      if (amount) {
        ledger.payment('card_1', amount, '2026-03-20');
      }

      return statusOn(ledger, '2026-04-01').latest!.state;
    };

    expect(state()).toBe('unpaid');
    expect(state(100)).toBe('part');
    expect(state(600)).toBe('minimum');
    expect(state(12_000)).toBe('paid');
  });

  it('counts a payment on the statement date toward the bill before', () => {
    const s = statusOn(
      card()
        .bill('card_1', '2026-04-15', '2026-05-05', 13_000, 650)
        .payment('card_1', 11_400, '2026-04-15'),
      '2026-04-20',
    );

    expect(s.latest).toMatchObject({ paid: 0, left: 13_000, state: 'unpaid' });
    expect(s.bills.map((b) => [b.bill.statementDate, b.paid, b.state])).toEqual([
      ['2026-04-15', 0, 'unpaid'],
      ['2026-03-15', 12_000, 'paid'],
    ]);
  });

  it('replaces what was left with the new bill', () => {
    const s = statusOn(
      card().bill('card_1', '2026-04-15', '2026-05-05', 13_000, 650),
      '2026-04-20',
    );

    expect(s.due).toBe(13_000);
    expect(s.bills[1]).toMatchObject({ left: 11_400, state: 'minimum', overdue: false });
  });

  it('goes into credit when paid more than the bill, and counts that as nothing due', () => {
    const ledger = card().payment('card_1', 12_000, '2026-03-25');
    const s = statusOn(ledger, '2026-04-01');

    expect(s).toMatchObject({ due: 0, credit: 600, overdue: false });
    expect(s.latest?.state).toBe('paid');
    expect(cardDues(cardStatuses(ledger.state(), '2026-04-01'))).toBe(0);
  });

  it('counts bills and payments only from their dates', () => {
    const ledger = card()
      .bill('card_1', '2026-04-15', '2026-05-05', 13_000)
      .payment('card_1', 5_000, '2026-04-01');

    expect(statusOn(ledger, '2026-03-10')).toMatchObject({ due: 0, limitUsed: null });
    expect(statusOn(ledger, '2026-03-10').latest).toBeUndefined();
    expect(statusOn(ledger, '2026-03-25').due).toBe(11_400);
    expect(statusOn(ledger, '2026-04-10').due).toBe(6_400);
    expect(statusOn(ledger, '2026-04-10').bills).toHaveLength(2);
  });

  it('is overdue after the due date until paid, but not on it', () => {
    expect(statusOn(card(), '2026-04-05').overdue).toBe(false);
    expect(statusOn(card(), '2026-04-06')).toMatchObject({ overdue: true, due: 11_400 });
    expect(statusOn(card().payment('card_1', 11_400, '2026-04-07'), '2026-04-08').overdue).toBe(
      false,
    );
  });

  it('lists payments newest first, and leaves limit used blank without a limit', () => {
    const ledger = card()
      .payment('card_1', 1_000, '2026-03-25')
      .card({ id: 'card_2', name: 'Shopping card' })
      .bill('card_2', '2026-03-01', '2026-03-21', 0);
    const [first, second] = cardStatuses(ledger.state(), '2026-04-01');

    expect(first!.payments.map((p) => p.date)).toEqual(['2026-03-25', '2026-03-20']);
    expect(second).toMatchObject({ due: 0, limitUsed: null, overdue: false });
    expect(second!.latest?.state).toBe('paid');
  });
});

describe('card totals and filters', () => {
  const two = () =>
    card()
      .card({ id: 'card_2', memberId: 'mem_2', name: 'Shopping card' })
      .bill('card_2', '2026-03-10', '2026-03-30', 5_000, 250);

  it('adds up what is left on every card, closed ones too', () => {
    const ledger = two().card({ id: 'card_2', memberId: 'mem_2', closed: '2026-03-31' });

    expect(cardDues(cardStatuses(ledger.state(), '2026-04-01'))).toBe(16_400);
  });

  it('follows the member filter and stays out of group and asset class filters', () => {
    const state = two().state();

    expect(cardStatuses(state, '2026-04-01', { memberId: 'mem_2' }).map((s) => s.card.id)).toEqual([
      'card_2',
    ]);
    expect(cardStatuses(state, '2026-04-01', { groupId: 'grp_1' })).toEqual([]);
    expect(cardStatuses(state, '2026-04-01', { assetClass: 'equity' })).toEqual([]);
    expect(cardStatuses(state, '2026-04-01', { accountId: 'acc_1' })).toEqual([]);
  });

  it('lists bills due in the window, with overdue ones first', () => {
    const due = cardsDue(cardStatuses(two().state(), '2026-04-01'), '2026-04-01', 30);

    expect(due.map((d) => [d.card.id, d.date, d.amount, d.overdue])).toEqual([
      ['card_2', '2026-03-30', 5_000, true],
      ['card_1', '2026-04-05', 11_400, false],
    ]);
    expect(cardsDue(cardStatuses(two().state(), '2026-04-01'), '2026-04-01', 3)).toHaveLength(1);
  });

  it('leaves paid bills out of what is due', () => {
    const state = card().payment('card_1', 11_400, '2026-03-28').state();

    expect(cardsDue(cardStatuses(state, '2026-04-01'), '2026-04-01', 30)).toEqual([]);
  });
});

describe('card rules', () => {
  const state = () => card().state();
  const bill = {
    id: 'cbl_new',
    cardId: 'card_1',
    statementDate: '2026-04-15',
    dueDate: '2026-05-05',
    amount: 13_000,
    minimumDue: 650,
  };
  const payment = { id: 'cpy_new', cardId: 'card_1', date: '2026-04-01', amount: 1_000 };

  it('needs a bank, a name, whose card, and a limit above zero if any', () => {
    const base = { id: 'card_9', memberId: 'mem_1', bank: 'Sample Bank', name: 'Travel card' };

    expect(cardProblem(state(), base)).toBeUndefined();
    expect(cardProblem(state(), { ...base, bank: ' ' })).toBe('Type the bank');
    expect(cardProblem(state(), { ...base, name: '' })).toBe('Type a name for the card');
    expect(cardProblem(state(), { ...base, memberId: 'mem_9' })).toBe('Choose whose card this is');
    expect(cardProblem(state(), { ...base, limit: 0 })).toBe(
      'Enter a limit above zero, or leave it blank',
    );
  });

  it('closes a card only when nothing is left to pay, and reopens it any time', () => {
    const open = cardOf(state());
    const paid = card().payment('card_1', 11_400, '2026-03-28').state();

    expect(cardProblem(state(), { ...open, closed: '2026-04-01' })).toBe(
      'Pay what’s left before closing the card',
    );
    expect(cardProblem(paid, { ...open, closed: '2026-04-01' })).toBeUndefined();

    const closed = card().card({ id: 'card_1', limit: 100_000, closed: '2026-04-01' }).state();

    expect(
      cardProblem(closed, { ...open, name: 'Old card', closed: '2026-04-01' }),
    ).toBeUndefined();
    expect(cardProblem(closed, open)).toBeUndefined();
  });

  it('needs a minimum no more than the bill, and a due date after the statement', () => {
    expect(billProblem(state(), bill)).toBeUndefined();
    expect(billProblem(state(), { ...bill, amount: 0, minimumDue: 0 })).toBeUndefined();
    expect(billProblem(state(), { ...bill, amount: -1 })).toBe('Enter the bill’s amount, or 0');
    expect(billProblem(state(), { ...bill, minimumDue: Number.NaN })).toBe(
      'Enter the minimum due, or 0',
    );
    expect(billProblem(state(), { ...bill, minimumDue: 14_000 })).toBe(
      'The minimum due can’t be more than the bill',
    );
    expect(billProblem(state(), { ...bill, dueDate: '2026-04-15' })).toBe(
      'The due date must be after the statement date',
    );
    expect(billProblem(state(), { ...bill, cardId: 'card_9' })).toBe('This card no longer exists');
    expect(billProblem(state(), { ...bill, statementDate: '' })).toBe('Enter the statement date');
    expect(billProblem(state(), { ...bill, dueDate: '' })).toBe('Enter the due date');
  });

  it('refuses two bills on one statement date, but allows older ones', () => {
    const [latest] = cardStatuses(state(), '2026-04-01')[0]!.bills;

    expect(billProblem(state(), { ...bill, statementDate: '2026-03-15' })).toBe(
      'There’s already a bill dated 2026-03-15',
    );
    expect(billProblem(state(), { ...latest!.bill, amount: 12_500 })).toBeUndefined();
    expect(
      billProblem(state(), { ...bill, statementDate: '2026-02-15', dueDate: '2026-03-05' }),
    ).toBeUndefined();
  });

  it('refuses payments of zero, before the first bill, or with no bill yet', () => {
    expect(paymentProblem(state(), payment)).toBeUndefined();
    expect(paymentProblem(state(), { ...payment, amount: 0 })).toBe('Enter an amount above zero');
    expect(paymentProblem(state(), { ...payment, date: '2026-03-15' })).toBe(
      'A payment must be after the first bill’s statement date, 2026-03-15',
    );
    expect(paymentProblem(state(), { ...payment, cardId: 'card_9' })).toBe(
      'This card no longer exists',
    );

    const bare = new Ledger().member().card({ id: 'card_1' }).state();

    expect(paymentProblem(bare, payment)).toBe('Add the bill first');
  });

  it('allows paying more than is left', () => {
    expect(paymentProblem(state(), { ...payment, amount: 50_000 })).toBeUndefined();
  });
});

describe('cards in net worth and analytics', () => {
  const book = new PriceBook([
    { key: 'amfi:1', date: '2026-04-01', close: 150, currency: 'INR', source: 'test' },
  ]);
  // A fund worth 15,000 that cost 10,000, plus 11,400 left to pay on a card.
  const fund = () =>
    card()
      .account({ id: 'acc_1', kind: 'mf' })
      .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
      .txn({ date: '2025-01-01', type: 'buy', units: 100, amount: 10_000 });
  const plainFund = () =>
    new Ledger()
      .member('mem_1', 'Asha')
      .account({ id: 'acc_1', kind: 'mf' })
      .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
      .txn({ date: '2025-01-01', type: 'buy', units: 100, amount: 10_000 });

  it('takes card dues off net worth, leaving returns alone', () => {
    const plain = summary(plainFund().state(), book, '2026-04-01');
    const s = summary(
      fund().loan({ id: 'loan_1' }).entry('loan_1', 'advance', 2_000, '2026-01-10').state(),
      book,
      '2026-04-01',
    );

    expect(s.investments).toBe(15_000);
    expect(s.cardDues).toBe(11_400);
    expect(s.netWorth).toBe(15_000 + 2_000 - 11_400);
    expect(s.netInvested).toBe(plain.netInvested);
    expect(s.totalGain).toBe(5_000);
    expect(s.xirr).toBe(plain.xirr);
    expect(s.absoluteReturn).toBe(plain.absoluteReturn);
    expect(s.holdings[0]?.weight).toBe(1);
  });

  it('keeps card dues to their member, and out of a group or asset class view', () => {
    const state = fund().state();

    expect(summary(state, book, '2026-04-01', { assetClass: 'equity' })).toMatchObject({
      netWorth: 15_000,
      cardDues: 0,
    });
    expect(summary(state, book, '2026-04-01', { memberId: 'mem_2' }).cardDues).toBe(0);
    expect(summary(state, book, '2026-04-01', { memberId: 'mem_1' }).cardDues).toBe(11_400);
  });

  it('never shows card dues as a slice', () => {
    const s = summary(fund().state(), book, '2026-04-01');
    const a = portfolioAnalytics(s.holdings, '2026-04-01', {}, s.loans, s.cardDues);
    const plain = portfolioAnalytics(s.holdings, '2026-04-01');

    expect(a.cardDues).toBe(11_400);
    expect(plain.cardDues).toBe(0);

    for (const key of ['assetSplit', 'instrumentSplit', 'currency'] as const) {
      expect(a[key]).toEqual(plain[key]);
    }
  });
});

describe('card checks', () => {
  it('asks for a backup when there are only cards', () => {
    const state = new Ledger().member().card({ id: 'card_1' }).state();

    expect(
      checks(state, new PriceBook([]), '2026-04-01').some((c) => c.type === 'backup.none'),
    ).toBe(true);
  });

  it('raises no card checks, even when a bill is overdue', () => {
    const types = checks(card().state(), new PriceBook([]), '2026-05-01').map((c) => c.type);

    expect(types).toEqual(['backup.none']);
  });
});

function cardOf(state: ReturnType<Ledger['state']>, id = 'card_1') {
  return cardStatuses(state, '2026-04-01').find((s) => s.card.id === id)!.card;
}
