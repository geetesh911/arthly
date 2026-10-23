// SPDX-License-Identifier: AGPL-3.0-only
// The words for each side of a loan, shared by the screens and the data worker.
import type { LoanDirection, LoanEntryType } from '@pv/core';

export interface LoanWords {
  /** The list a loan sits in. */
  section: string;
  /** "Sample friend owes you", "You owe Sample relative". */
  owes: (party: string) => string;
  /** What each kind of entry is called in its history. */
  entry: Record<LoanEntryType, string>;
  /** Adding to the amount owed. */
  more: string;
  /** The total handed over. */
  total: string;
}

export const LOAN_WORDS: Record<LoanDirection, LoanWords> = {
  lent: {
    section: 'Owed to you',
    owes: (party) => `${party} owes you`,
    entry: { advance: 'Lent', repayment: 'Got back', 'write-off': 'Written off' },
    more: 'Lent more',
    total: 'Lent',
  },
  borrowed: {
    section: 'You owe',
    owes: (party) => `You owe ${party}`,
    entry: { advance: 'Borrowed', repayment: 'Paid back', 'write-off': 'Written off' },
    more: 'Borrowed more',
    total: 'Borrowed',
  },
};
