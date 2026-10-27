// SPDX-License-Identifier: AGPL-3.0-only
// EPFO's member passbook PDF: one member ID and one financial year per file. It gives the opening
// balance, each month's contributions, the year's totals and interest, and the closing balance,
// each split into employee, employer and pension (EPS) shares. Each line read from the PDF is one
// row of the page, so a row's amounts are its last words, with the three shares last.
import { findDate, num } from '../../../import/sheet.ts';
import type { ImportDraft, Importer, InputFile } from '../../../import/types.ts';
import { mask } from '../../../model/ids.ts';
import type { TransactionType } from '../../../model/types.ts';
import { addDays, fyEnd, fyOf, type ISODate, maxDate, minDate } from '../../../util/dates.ts';
import { near, roundAmount } from '../../../util/numbers.ts';

type Part = 'employee' | 'employer' | 'pension';
type Shares = Record<Part, number>;

const PARTS: Part[] = ['employee', 'employer', 'pension'];

interface Row {
  date: ISODate;
  credit: boolean;
  /** A monthly contribution, rather than a transfer in or an adjustment. */
  monthly: boolean;
  shares: Shares;
}

interface Passbook {
  establishment?: string;
  memberId?: string;
  fy?: number;
  opening?: { date?: ISODate; shares: Shares };
  rows: Row[];
  /** Lines that look like entries but have no amounts. */
  unread: number;
  totals: { contributions?: Shares; transfers?: Shares; withdrawals?: Shares };
  interest?: { date?: ISODate; shares: Shares };
  closing?: { date?: ISODate; shares: Shares };
  printed?: ISODate;
}

/** 1,23,456, 999 or 0, but not a due month such as 042026 or a year. */
const AMOUNT = /^-?\d{1,3}(,\d{2,3})*(\.\d+)?$/;

/** "Mar-2026 15-04-2026 CR Cont. for Due-Month 042026"; the wage month can be blank. */
const ENTRY = /^(?:[A-Za-z]{3}-\d{4}\s+)?(\d{2}-\d{2}-\d{4})\s+(CR|DR)(?:\s+(.*))?$/;

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const zero = (): Shares => ({ employee: 0, employer: 0, pension: 0 });

function add(a: Shares, b: Shares, sign = 1): Shares {
  return {
    employee: a.employee + sign * b.employee,
    employer: a.employer + sign * b.employer,
    pension: a.pension + sign * b.pension,
  };
}

const sameShares = (a: Shares, b: Shares) => PARTS.every((p) => near(a[p], b[p], 1));

/** The line without its trailing amounts, and the last three of them as the shares. */
function split(line: string): { head: string; shares?: Shares } {
  const words = line.split(' ');
  let n = words.length;

  while (n > 0 && AMOUNT.test(words[n - 1]!)) {
    n--;
  }

  const head = words.slice(0, n).join(' ');
  const amounts = words.slice(n).map((w) => Math.abs(num(w) ?? 0));

  if (amounts.length < 3) {
    return { head };
  }

  const [employee, employer, pension] = amounts.slice(-3) as [number, number, number];

  return { head, shares: { employee, employer, pension } };
}

function read(lines: string[]): Passbook {
  const book: Passbook = { rows: [], unread: 0, totals: {} };

  for (const [n, line] of lines.entries()) {
    let m = /\bOn\s*:\s*(\d{2}-\d{2}-\d{4})/i.exec(line);

    if (m) {
      book.printed = findDate(m[1]);
    }

    if ((m = /Establishment ID\/Name:?\s*[A-Z0-9]+\s*\/\s*(.+)$/i.exec(line))) {
      book.establishment = m[1]!.trim();
      continue;
    }

    if ((m = /Member ID\/Name:?\s*([A-Z0-9]+)/i.exec(line))) {
      book.memberId = m[1];
      continue;
    }

    if ((m = /Financial Year\s*-?\s*(\d{4})\s*-\s*\d{2,4}/i.exec(line))) {
      book.fy = Number(m[1]);
      continue;
    }

    const { head, shares } = split(line);
    const balance = shares && { date: findDate(head), shares };

    if ((m = ENTRY.exec(head))) {
      const date = findDate(m[1]);

      if (!date || !shares) {
        book.unread++;
      } else {
        // Where the description wraps, its first line sits on the row above the amounts.
        const about = m[3] ?? lines[n - 1] ?? '';

        book.rows.push({
          date,
          credit: m[2] === 'CR',
          monthly: /^cont\b/i.test(about),
          shares,
        });
      }
    } else if (/^OB\b/i.test(head)) {
      book.opening = balance;
    } else if (/^Total Contributions/i.test(head)) {
      book.totals.contributions = shares;
    } else if (/^Total Transfer/i.test(head)) {
      book.totals.transfers = shares;
    } else if (/^Total Withdrawals/i.test(head)) {
      book.totals.withdrawals = shares;
    } else if (/^(Interest details|Int\.? Updated)/i.test(head)) {
      book.interest = balance;
    } else if (/^Closing Balance/i.test(head)) {
      book.closing = balance;
    }
  }

  return book;
}

async function passbook(file: InputFile): Promise<{ book: Passbook; known: boolean }> {
  const lines = (await file.pdfText()).flatMap((p) => p.lines);

  return {
    book: read(lines),
    known: lines.some((l) => /Member Passbook|EPF Passbook/i.test(l)),
  };
}

/** "ACME SOFTWARE PRIVATE LIMITED" becomes "Acme Software Private Limited"; mixed case stays. */
function titleCase(name: string): string {
  if (name !== name.toUpperCase()) {
    return name;
  }

  return name.toLowerCase().replace(/(^|[\s(&./-])(\p{L})/gu, (_, gap, c) => gap + c.toUpperCase());
}

/** Warns when the rows don't add up to the passbook's own totals and closing balance. */
function check(book: Passbook): string[] {
  const sum = (test: (r: Row) => boolean) =>
    book.rows.filter(test).reduce((s, r) => add(s, r.shares), zero());
  const warnings: string[] = [];
  const { contributions, transfers, withdrawals } = book.totals;
  const mismatched = [
    contributions &&
      !sameShares(
        sum((r) => r.credit && r.monthly),
        contributions,
      ) &&
      'contributions',
    transfers &&
      !sameShares(
        sum((r) => r.credit && !r.monthly),
        transfers,
      ) &&
      'transfers in',
    withdrawals &&
      !sameShares(
        sum((r) => !r.credit),
        withdrawals,
      ) &&
      'withdrawals',
  ].filter(Boolean);

  if (mismatched.length) {
    warnings.push(
      `The ${mismatched.join(' and ')} in the passbook don't add up to its totals for the year. Check the entries against your passbook.`,
    );
  }

  if (book.opening && book.closing) {
    const expected = add(
      add(
        add(
          book.opening.shares,
          sum((r) => r.credit),
        ),
        sum((r) => !r.credit),
        -1,
      ),
      book.interest?.shares ?? zero(),
    );

    if (!sameShares(expected, book.closing.shares)) {
      warnings.push(
        "The passbook's entries don't add up to its closing balance. Check them against your passbook.",
      );
    }
  }

  if (book.unread) {
    warnings.push(
      `${book.unread} ${book.unread === 1 ? 'entry' : 'entries'} in the passbook couldn't be read. Check them against your passbook.`,
    );
  }

  return warnings;
}

export const epfoPassbook: Importer = {
  id: 'epfo-passbook',
  version: 1,
  label: 'EPFO member passbook (PDF)',
  extensions: ['.pdf'],

  async detect(file) {
    const { book, known } = await passbook(file);

    if (!book.memberId) {
      return 0;
    }

    return known ? 0.95 : 0.7;
  },

  async parse(file, ctx) {
    const { book } = await passbook(file);

    if (!book.memberId) {
      throw new Error('No member ID found in this passbook');
    }

    // The heading names the year; failing that, it starts with the opening balance, dated 31 March
    // or, in some passbooks, 1 April.
    const fy =
      book.fy ??
      (book.opening?.date ? fyOf(addDays(book.opening.date, -1)) + 1 : undefined) ??
      (book.rows[0] ? fyOf(book.rows[0].date) : undefined);

    if (fy === undefined) {
      throw new Error('No financial year found in this passbook');
    }

    const draft: ImportDraft = {
      accounts: [],
      instruments: [],
      transactions: [],
      snapshots: [],
      warnings: check(book),
    };

    const maskedRef = mask(book.memberId);
    const institution = book.establishment ? titleCase(book.establishment) : 'EPFO';
    const suffix = ` ${maskedRef}`;
    const pension = [book.opening, book.closing, ...book.rows].some((b) => b && b.shares.pension);

    draft.accounts.push({
      ref: 'epf',
      institution,
      kind: 'epf',
      label: `${institution} EPF${suffix}`,
      maskedRef,
      currency: 'INR',
    });

    for (const kind of pension ? (['epf', 'eps'] as const) : (['epf'] as const)) {
      draft.instruments.push({
        ref: kind,
        kind,
        name: `${kind.toUpperCase()} (${institution}${suffix})`,
        currency: 'INR',
        assetClass: 'debt',
        ids: {},
      });
    }

    const entry = (part: Part, date: ISODate, type: TransactionType, amount: number) => {
      if (amount <= 0 || (part === 'pension' && !pension)) {
        return;
      }

      draft.transactions.push({
        account: 'epf',
        instrument: part === 'pension' ? 'eps' : 'epf',
        date,
        type,
        amount: roundAmount(amount),
        currency: 'INR',
        meta: { part },
      });
    };

    for (const row of book.rows) {
      for (const part of PARTS) {
        entry(part, row.date, row.credit ? 'contribution' : 'withdrawal', row.shares[part]);
      }
    }

    // EPS earns no interest, so only the EPF shares are credited.
    const interestDate = book.interest?.date ?? fyEnd(fy);

    for (const part of ['employee', 'employer'] as const) {
      entry(part, interestDate, 'interest', book.interest?.shares[part] ?? 0);
    }

    const balances = (
      asOf: ISODate,
      shares: Shares,
      skipZero: boolean,
      openingWarnings?: string[],
    ) => {
      const epf = roundAmount(shares.employee + shares.employer);
      const opening = openingWarnings ? { openingWarnings } : {};

      if (!skipZero || epf > 0) {
        draft.snapshots.push({
          account: 'epf',
          instrument: 'epf',
          asOf,
          units: epf,
          value: epf,
          ...opening,
        });
      }

      if (pension && (!skipZero || shares.pension > 0)) {
        draft.snapshots.push({
          account: 'epf',
          instrument: 'eps',
          asOf,
          units: shares.pension,
          value: shares.pension,
          ...opening,
        });
      }
    };

    // The balance the year starts with, though some passbooks date it 1 April.
    const openedAt = fyEnd(fy - 1);

    if (book.opening) {
      const total = PARTS.reduce((s, p) => s + book.opening!.shares[p], 0);

      balances(openedAt, book.opening.shares, true, [
        `The passbook starts with a balance of ${inr(total)} on ${openedAt}. Import older passbooks for the full history; until then it counts as one deposit.`,
      ]);
    }

    // A passbook for the current year gives its closing balance at the year's end, but it is
    // only known up to the day the passbook was printed.
    const latest = [openedAt, ...draft.transactions.map((t) => t.date)].reduce(maxDate);
    const asOf = maxDate(
      latest,
      minDate(book.closing?.date ?? fyEnd(fy), book.printed ?? ctx.today),
    );

    draft.asOf = asOf;

    if (book.closing && asOf !== openedAt) {
      balances(asOf, book.closing.shares, false);
    }

    return draft;
  },
};
