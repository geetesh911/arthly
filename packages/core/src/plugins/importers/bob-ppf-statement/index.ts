// SPDX-License-Identifier: AGPL-3.0-only
// Bank of Baroda's PPF statement Excel (OpTransactionHistory): one row per posting, newest first,
// with a running balance. Entries are dated by value date, the date that counts for interest.
import { findCell, findDate, findHeader, num, rowsBelow, text } from '../../../import/sheet.ts';
import type { Cell, ImportDraft, Importer, InputFile } from '../../../import/types.ts';
import { mask } from '../../../model/ids.ts';
import type { TransactionType } from '../../../model/types.ts';
import {
  addDays,
  day,
  fyOf,
  makeDate,
  maxDate,
  minDate,
  month,
  year,
  type ISODate,
} from '../../../util/dates.ts';
import { near, roundAmount } from '../../../util/numbers.ts';

const HEADINGS = {
  posted: ['tran date'],
  date: ['value date'],
  narration: ['narration'],
  debit: ['withdrawal(dr)'],
  credit: ['deposit(cr)'],
  balance: ['balance(inr)'],
};

const INSTITUTION = 'Bank of Baroda';

interface Posting {
  posted: ISODate;
  date: ISODate;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** "12,345.00Cr" is in credit; a "Dr" balance is below zero. */
function runningBalance(c: Cell | undefined): number | undefined {
  const t = text(c);
  const n = num(t.replace(/(cr|dr)\.?$/i, ''));
  return n !== undefined && /dr\.?$/i.test(t) ? -n : n;
}

/** 31 March, or the first half of April, when banks post the year's interest. */
const atYearEnd = (d: ISODate) =>
  (month(d) === 3 && day(d) === 31) || (month(d) === 4 && day(d) <= 15);

/** PPF deposits must be in multiples of ₹50. */
const roundFifty = (amount: number) => Math.round(amount * 100) % 5000 === 0;

const isInterest = (p: Posting) =>
  /\bint(erest)?\b/i.test(p.narration) || (atYearEnd(p.date) && !roundFifty(p.credit));

/** Other credits are multiples of ₹50, and there is at most one withdrawal a year. */
function looksLikePpf(postings: Posting[]): boolean {
  const withdrawalYears = postings.filter((p) => p.debit > 0).map((p) => fyOf(p.date));
  return (
    postings.every((p) => p.credit === 0 || roundFifty(p.credit) || atYearEnd(p.date)) &&
    new Set(withdrawalYears).size === withdrawalYears.length
  );
}

async function statement(file: InputFile) {
  for (const sheet of await file.sheets()) {
    const header = findHeader(sheet.rows, HEADINGS);
    if (!header) continue;
    const { col } = header;
    const postings: Posting[] = [];
    for (const row of rowsBelow(sheet.rows, header.row)) {
      const posted = findDate(row[col.posted]);
      const debit = num(row[col.debit]) ?? 0;
      const credit = num(row[col.credit]) ?? 0;
      const balance = runningBalance(row[col.balance]);
      if (!posted || balance === undefined || (debit === 0 && credit === 0)) continue;
      const date = findDate(row[col.date]) ?? posted;
      postings.push({ posted, date, narration: text(row[col.narration]), debit, credit, balance });
    }
    // The bank lists the newest posting first; the running balance needs posting order.
    if (postings.length > 1 && postings[0]!.posted > postings.at(-1)!.posted) postings.reverse();
    return { rows: sheet.rows, postings };
  }
  return undefined;
}

/** The cell after "Account No:". */
function accountNumber(rows: Cell[][]): string | undefined {
  const at = findCell(rows, (t) => /^account no\.?\s*:?$/.test(t));
  return at
    ? rows[at.row]!.slice(at.col + 1)
        .map(text)
        .find(Boolean)
    : undefined;
}

/** The "to" date of "Statement Period from … to …". */
function periodEnd(rows: Cell[][]): ISODate | undefined {
  const at = findCell(rows, (t) => t.startsWith('statement period'));
  return at ? findDate(text(rows[at.row]![at.col]).split(/\bto\b/i)[1]) : undefined;
}

export const bobPpfStatement: Importer = {
  id: 'bob-ppf-statement',
  version: 1,
  label: 'Bank of Baroda PPF statement (Excel)',
  extensions: ['.xlsx', '.xls'],

  async detect(file) {
    const found = await statement(file);
    if (!found) return 0;
    // The same layout is used for savings accounts, so the entries must look like PPF.
    if (!looksLikePpf(found.postings)) return 0.3;
    const named =
      /ppf|public provident/i.test(file.name) ||
      findCell(found.rows, (t) => /\bppf\b|public provident/.test(t)) !== undefined;
    return named ? 0.95 : 0.75;
  },

  async parse(file) {
    const found = await statement(file);
    if (!found) throw new Error('No statement table found');
    const { rows, postings } = found;
    const first = postings[0];
    if (!first) throw new Error('The statement lists no transactions');
    const draft: ImportDraft = {
      accounts: [],
      instruments: [],
      transactions: [],
      snapshots: [],
      warnings: [],
    };

    const opening = roundAmount(first.balance - first.credit + first.debit);
    let expected = opening;
    for (const [n, p] of postings.entries()) {
      expected += p.credit - p.debit;
      if (!near(expected, p.balance, 0.01)) {
        draft.warnings.push(
          `The running balance in the file doesn't add up after ${postings[n - 1]!.posted}. Check the entries against your passbook.`,
        );
        break;
      }
    }

    const number = accountNumber(rows);
    const maskedRef = number ? mask(number) : undefined;
    const suffix = maskedRef ? ` ${maskedRef}` : '';
    const earliest = postings.map((p) => p.date).reduce(minDate);
    draft.accounts.push({
      ref: 'ppf',
      institution: INSTITUTION,
      kind: 'ppf',
      label: `${INSTITUTION} PPF${suffix}`,
      ...(maskedRef ? { maskedRef } : {}),
      currency: 'INR',
    });
    draft.instruments.push({
      ref: 'ppf',
      kind: 'ppf',
      name: `PPF (${INSTITUTION}${suffix})`,
      currency: 'INR',
      assetClass: 'debt',
      ids: {},
      // With no balance before the first entry, that entry opened the account.
      ...(opening === 0 ? { terms: { opened: earliest } } : {}),
    });

    for (const p of postings) {
      const type: TransactionType =
        p.debit > 0 ? 'withdrawal' : isInterest(p) ? 'interest' : 'contribution';
      draft.transactions.push({
        account: 'ppf',
        instrument: 'ppf',
        date: p.date,
        type,
        amount: roundAmount(p.debit > 0 ? p.debit : p.credit),
        currency: 'INR',
      });
    }
    draft.transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (opening !== 0) {
      // Dated before the first entry, and early enough that its month earns interest on it.
      const asOf =
        day(earliest) === 1 ? addDays(earliest, -1) : makeDate(year(earliest), month(earliest), 1);
      draft.snapshots.push({
        account: 'ppf',
        instrument: 'ppf',
        asOf,
        units: opening,
        value: opening,
      });
      draft.warnings.push(
        `The statement starts with a balance of ${inr(opening)} on ${asOf}. Import older statements for the full history; until then it counts as one deposit.`,
        'Add the date this PPF account was opened to see when it matures',
      );
    }

    const latest = postings.map((p) => p.date).reduce(maxDate);
    const asOf = maxDate(periodEnd(rows) ?? latest, latest);
    const closing = postings.at(-1)!.balance;
    draft.asOf = asOf;
    draft.snapshots.push({
      account: 'ppf',
      instrument: 'ppf',
      asOf,
      units: closing,
      value: closing,
    });
    return draft;
  },
};
