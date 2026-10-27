// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { portfolioAnalytics } from './analytics.ts';
import { checks } from './checks.ts';
import {
  entryRemovalProblem,
  loanEntryProblem,
  loanProblem,
  loansApply,
  loansDue,
  loanStatuses,
  loanTotals,
} from './loans.ts';
import { planning } from './plan.ts';
import { summary } from './portfolio.ts';
import { PriceBook } from './prices.ts';
import { Ledger } from './testkit.ts';

/** Lent 50,000 to a friend on 10 Jan, due 1 Feb, with 20,000 back on 1 Mar. */
const lent = () =>
  new Ledger()
    .member('mem_1', 'Asha')
    .member('mem_2', 'Ravi')
    .loan({ id: 'loan_1', due: '2026-02-01' })
    .entry('loan_1', 'advance', 50_000, '2026-01-10')
    .entry('loan_1', 'repayment', 20_000, '2026-03-01');

describe('loan balances', () => {
  it('takes part repayments off the amount lent', () => {
    const [s] = loanStatuses(lent().state(), '2026-04-01');

    expect(s).toMatchObject({
      advanced: 50_000,
      repaid: 20_000,
      writtenOff: 0,
      balance: 30_000,
      open: true,
      start: '2026-01-10',
    });
    expect(s!.settled).toBeUndefined();
    expect(s!.entries.map((e) => e.type)).toEqual(['advance', 'repayment']);
  });

  it('settles once the rest is paid back, and leaves the totals', () => {
    const state = lent().entry('loan_1', 'repayment', 30_000, '2026-03-20').state();
    const [s] = loanStatuses(state, '2026-04-01');

    expect(s).toMatchObject({ balance: 0, open: false, settled: '2026-03-20', overdue: false });
    expect(loanTotals(loanStatuses(state, '2026-04-01')).owedToYou).toBe(0);
  });

  it('counts a write-off against the balance but apart from repayments', () => {
    const state = lent().entry('loan_1', 'write-off', 30_000, '2026-05-01').state();
    const [s] = loanStatuses(state, '2026-06-01');

    expect(s).toMatchObject({ repaid: 20_000, writtenOff: 30_000, balance: 0, open: false });
  });

  it('counts entries only from their date', () => {
    expect(loanStatuses(lent().state(), '2026-02-15')[0]?.balance).toBe(50_000);
    const before = loanStatuses(lent().state(), '2026-01-01')[0];

    expect(before).toMatchObject({ balance: 0, open: false });
    expect(before?.settled).toBeUndefined();
  });

  it('is overdue while open after its due date', () => {
    expect(loanStatuses(lent().state(), '2026-04-01')[0]?.overdue).toBe(true);
    expect(loanStatuses(lent().state(), '2026-01-20')[0]?.overdue).toBe(false);
  });
});

describe('loan totals and filters', () => {
  const both = () =>
    lent()
      .loan({ id: 'loan_2', memberId: 'mem_2', direction: 'borrowed', party: 'Sample relative' })
      .entry('loan_2', 'advance', 10_000, '2026-02-01');

  it('adds up what is owed each way', () => {
    expect(loanTotals(loanStatuses(both().state(), '2026-04-01'))).toEqual({
      owedToYou: 30_000,
      youOwe: 10_000,
      owedToYouByMember: { mem_1: 30_000 },
    });
  });

  it('counts an overpaid loan as nothing owed', () => {
    const state = lent().entry('loan_1', 'repayment', 40_000, '2026-03-02').state();
    const [s] = loanStatuses(state, '2026-04-01');

    expect(s?.balance).toBe(-10_000);
    expect(s?.open).toBe(false);
    expect(loanTotals([s!]).owedToYou).toBe(0);
  });

  it('follows the member filter and stays out of group and asset class filters', () => {
    const state = both().state();

    expect(loanStatuses(state, '2026-04-01', { memberId: 'mem_2' }).map((s) => s.loan.id)).toEqual([
      'loan_2',
    ]);
    expect(loanStatuses(state, '2026-04-01', { groupId: 'grp_1' })).toEqual([]);
    expect(loansApply({})).toBe(true);
    expect(loansApply({ memberId: 'mem_1' })).toBe(true);
    expect(loansApply({ groupId: 'grp_1' })).toBe(false);
    expect(loansApply({ assetClass: 'equity' })).toBe(false);
    expect(loansApply({ accountId: 'acc_1', instrumentId: 'ins_1' })).toBe(false);
  });

  it('lists open loans falling due in the window', () => {
    const state = both()
      .loan({ id: 'loan_3', party: 'Sample neighbour', due: '2026-04-20' })
      .entry('loan_3', 'advance', 5_000, '2026-03-01')
      .state();
    const due = loansDue(loanStatuses(state, '2026-04-01'), '2026-04-01', 30);

    expect(due.map((d) => [d.date, d.loan.id, d.amount])).toEqual([
      ['2026-04-20', 'loan_3', 5_000],
    ]);
  });
});

describe('loan rules', () => {
  const entry = (
    type: 'advance' | 'repayment' | 'write-off',
    amount: number,
    date = '2026-04-01',
  ) => ({ id: 'lne_new', loanId: 'loan_1', date, type, amount }) as const;

  it('refuses amounts of zero or less', () => {
    expect(loanEntryProblem(lent().state(), entry('repayment', 0))).toBe(
      'Enter an amount above zero',
    );
    expect(loanEntryProblem(lent().state(), entry('advance', Number.NaN))).toBe(
      'Enter an amount above zero',
    );
  });

  it('refuses paying back more than is owed, but not exactly that', () => {
    expect(loanEntryProblem(lent().state(), entry('repayment', 30_001))).toBe(
      'That’s more than the ₹30,000 still owed',
    );
    expect(loanEntryProblem(lent().state(), entry('write-off', 30_000))).toBeUndefined();
    expect(loanEntryProblem(lent().state(), entry('advance', 1_000_000))).toBeUndefined();
  });

  it('refuses a payment before the loan started', () => {
    expect(loanEntryProblem(lent().state(), entry('repayment', 100, '2026-01-01'))).toBe(
      'A payment can’t be before the loan started on 2026-01-10',
    );
  });

  it('refuses an entry for a loan that is gone', () => {
    expect(loanEntryProblem(lent().state(), { ...entry('repayment', 100), loanId: 'loan_9' })).toBe(
      'This loan no longer exists',
    );
  });

  it('refuses deleting an entry that would leave more paid back than lent', () => {
    const state = lent().state();
    const [s] = loanStatuses(state, '2026-04-01');
    const [advance, repayment] = s!.entries;

    expect(entryRemovalProblem(state, advance!.id)).toBe(
      'That would leave more paid back than lent. Delete a payment first.',
    );
    expect(entryRemovalProblem(state, repayment!.id)).toBeUndefined();
  });

  it('needs who, whose, and a due date after the start', () => {
    const state = lent().state();
    const loan = {
      id: 'loan_1',
      memberId: 'mem_1',
      direction: 'lent',
      party: 'Sample friend',
    } as const;

    expect(loanProblem(state, loan)).toBeUndefined();
    expect(loanProblem(state, { ...loan, party: '  ' })).toBe('Type who the loan is with');
    expect(loanProblem(state, { ...loan, memberId: 'mem_9' })).toBe('Choose whose loan this is');
    expect(loanProblem(state, { ...loan, due: '2026-01-01' })).toBe(
      'The due date is before the loan started on 2026-01-10',
    );
  });
});

describe('loans in net worth and analytics', () => {
  const book = new PriceBook([
    { key: 'amfi:1', date: '2026-04-01', close: 150, currency: 'INR', source: 'test' },
  ]);
  // A fund worth 15,000 that cost 10,000, plus 30,000 owed to you and 10,000 you owe.
  const fund = () =>
    new Ledger()
      .member('mem_1', 'Asha')
      .account({ id: 'acc_1', kind: 'mf' })
      .instrument({ id: 'ins_1', kind: 'mf', ids: { amfi: '1' } })
      .txn({ date: '2025-01-01', type: 'buy', units: 100, amount: 10_000 });
  const withLoans = () =>
    fund()
      .loan({ id: 'loan_1' })
      .entry('loan_1', 'advance', 50_000, '2026-01-10')
      .entry('loan_1', 'repayment', 20_000, '2026-03-01')
      .loan({ id: 'loan_2', direction: 'borrowed', party: 'Sample relative' })
      .entry('loan_2', 'advance', 10_000, '2026-02-01');

  it('adds what you are owed and takes off what you owe, leaving returns alone', () => {
    const plain = summary(fund().state(), book, '2026-04-01');
    const s = summary(withLoans().state(), book, '2026-04-01');

    expect(s.investments).toBe(15_000);
    expect(s.loans).toEqual({
      owedToYou: 30_000,
      youOwe: 10_000,
      owedToYouByMember: { mem_1: 30_000 },
    });
    expect(s.netWorth).toBe(35_000);
    expect(s.netInvested).toBe(plain.netInvested);
    expect(s).toMatchObject({ invested: plain.invested, gain: 5_000, realised: 0 });
    expect(s.xirr).toBe(plain.xirr);
    expect(s.absoluteReturn).toBe(plain.absoluteReturn);
    expect(s.holdings[0]?.weight).toBe(1);
  });

  it('leaves loans out of a group or asset class view', () => {
    const s = summary(withLoans().state(), book, '2026-04-01', { assetClass: 'equity' });

    expect(s.netWorth).toBe(15_000);
    expect(s.loans.owedToYou).toBe(0);
  });

  it('shows what you are owed as a slice, and never what you owe', () => {
    const s = summary(withLoans().state(), book, '2026-04-01');
    const a = portfolioAnalytics(s.holdings, '2026-04-01', {}, s.loans);
    const plain = portfolioAnalytics(s.holdings, '2026-04-01');
    const p = planning(s.holdings, '2026-04-01', {}, s.loans);
    const slices = (b: typeof a.assetSplit) => b.slices.map((x) => [x.label, x.value]);

    expect(slices(a.assetSplit)).toEqual([
      ['Owed to you', 30_000],
      ['equity', 15_000],
    ]);
    expect(slices(p.liquidity)).toEqual([
      ['Owed to you', 30_000],
      ['Market-linked holdings', 15_000],
    ]);
    expect(a.instrumentSplit).toEqual(plain.instrumentSplit);
    expect(a.currency).toEqual(plain.currency);
    // The planner leaves loans out: rebalancing into a friend's loan makes no sense.
    expect(p.assetValues).toEqual({ equity: 15_000 });
    expect(p.total).toBe(15_000);
    expect(a.total).toBe(15_000);
    expect(a.loans).toEqual({ owedToYou: 30_000, youOwe: 10_000 });

    for (const b of [a.assetSplit, p.liquidity, a.instrumentSplit, a.currency]) {
      expect(b.slices.every((x) => x.value > 0 && !/owe$/i.test(x.label))).toBe(true);
    }
  });
});

describe('loan checks', () => {
  const book = new PriceBook([]);

  it('warns about an overdue loan each way until dismissed', () => {
    const ledger = lent()
      .loan({
        id: 'loan_2',
        direction: 'borrowed',
        party: 'Sample relative',
        due: '2026-03-01',
      })
      .entry('loan_2', 'advance', 10_000, '2026-01-01');
    const overdue = (state = ledger.state()) =>
      checks(state, book, '2026-04-01').filter((c) => c.type === 'loan.overdue');

    expect(overdue()).toEqual([
      {
        key: 'loan.overdue:loan_1:2026-02-01',
        type: 'loan.overdue',
        severity: 'warn',
        message: 'Sample friend was due to pay back ₹30,000 by 2026-02-01',
        fix: { kind: 'open-loan', ref: 'loan_1' },
      },
      {
        key: 'loan.overdue:loan_2:2026-03-01',
        type: 'loan.overdue',
        severity: 'warn',
        message: 'You were due to pay Sample relative back ₹10,000 by 2026-03-01',
        fix: { kind: 'open-loan', ref: 'loan_2' },
      },
    ]);
    const dismissed = ledger
      .put('dismissal', { id: 'dis_1', checkKey: 'loan.overdue:loan_1:2026-02-01' })
      .state();

    expect(overdue(dismissed).map((c) => c.key)).toEqual(['loan.overdue:loan_2:2026-03-01']);
  });

  it('asks for a backup when there are only loans', () => {
    expect(checks(lent().state(), book, '2026-04-01').some((c) => c.type === 'backup.none')).toBe(
      true,
    );
  });
});
