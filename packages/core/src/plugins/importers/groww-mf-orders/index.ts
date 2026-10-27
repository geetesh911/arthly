// SPDX-License-Identifier: AGPL-3.0-only
// Groww's mutual-fund order history: every purchase and redemption with its units, NAV and date.
// It names no folio, so each fund's orders go to the folio already holding that fund.
import {
  findCell,
  findDate,
  findHeader,
  lower,
  num,
  rangeEnd,
  rowsBelow,
  text,
} from '../../../import/sheet.ts';
import type { ImportDraft, Importer, InputFile } from '../../../import/types.ts';
import { defaultAssetClass } from '../../../model/classify.ts';
import { normaliseName } from '../../../model/ids.ts';
import type { TransactionType } from '../../../model/types.ts';
import { roundAmount, roundPrice, roundUnits } from '../../../util/numbers.ts';

const HEADINGS = {
  scheme: ['scheme name'],
  type: ['transaction type'],
  units: ['units'],
  nav: ['nav'],
  amount: ['amount'],
  date: ['date'],
};

const TITLE = 'transactions from';
const TYPES: Record<string, TransactionType> = {
  purchase: 'buy',
  redeem: 'sell',
  redemption: 'sell',
  'switch in': 'switch-in',
  'switch out': 'switch-out',
};

async function ordersSheet(file: InputFile) {
  for (const sheet of await file.sheets()) {
    const header = findHeader(sheet.rows, HEADINGS);

    if (header) {
      return { rows: sheet.rows, header };
    }
  }

  return undefined;
}

export const growwMfOrders: Importer = {
  id: 'groww-mf-orders',
  version: 1,
  label: 'Groww mutual funds (order history)',
  extensions: ['.xlsx', '.xls'],

  async detect(file) {
    const found = await ordersSheet(file);

    if (!found) {
      return 0;
    }

    return findCell(found.rows, (t) => t.startsWith(TITLE)) ? 0.95 : 0.7;
  },

  async parse(file) {
    const found = await ordersSheet(file);

    if (!found) {
      throw new Error('No order table found');
    }

    const { rows, header } = found;
    const { col } = header;
    const draft: ImportDraft = {
      accounts: [],
      instruments: [],
      transactions: [],
      snapshots: [],
      warnings: [],
    };

    const titleAt = findCell(rows, (t) => t.startsWith(TITLE));
    const asOf = titleAt ? rangeEnd(rows[titleAt.row]![titleAt.col]) : undefined;

    if (asOf) {
      draft.asOf = asOf;
    }

    const account = 'groww';

    draft.accounts.push({
      ref: account,
      institution: 'Groww',
      kind: 'mf',
      label: 'Groww mutual funds',
      currency: 'INR',
      byHolding: true,
    });

    let unread = 0;
    const otherTypes = new Set<string>();

    for (const row of rowsBelow(rows, header.row)) {
      const scheme = text(row[col.scheme]);

      if (!scheme) {
        continue;
      }

      const type = TYPES[lower(row[col.type]).replace(/[_-]/g, ' ')];

      if (!type) {
        otherTypes.add(text(row[col.type]));
        continue;
      }

      const units = num(row[col.units]);
      const amount = num(row[col.amount]);
      const nav = num(row[col.nav]);
      const date = findDate(row[col.date]);

      if (units === undefined || units <= 0 || amount === undefined || !date) {
        unread += 1;
        continue;
      }

      const instrument = `scheme:${normaliseName(scheme)}`;

      if (!draft.instruments.some((i) => i.ref === instrument)) {
        draft.instruments.push({
          ref: instrument,
          kind: 'mf',
          name: scheme,
          currency: 'INR',
          assetClass: defaultAssetClass('mf', scheme),
          ids: {},
        });
      }

      draft.transactions.push({
        account,
        instrument,
        date,
        type,
        units: roundUnits(units),
        ...(nav !== undefined ? { price: roundPrice(nav) } : {}),
        amount: roundAmount(amount),
        currency: 'INR',
      });
    }

    if (otherTypes.size > 0) {
      draft.warnings.push(`Left out transactions of type ${[...otherTypes].join(', ')}`);
    }

    if (unread > 0) {
      draft.warnings.push(
        `${unread} ${unread === 1 ? "transaction couldn't" : "transactions couldn't"} be read. Check them against the file.`,
      );
    }

    if (draft.transactions.length === 0) {
      draft.warnings.push('The file lists no transactions');
    }

    return draft;
  },
};
