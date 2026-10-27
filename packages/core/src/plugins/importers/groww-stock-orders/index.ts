// SPDX-License-Identifier: AGPL-3.0-only
// Groww's stock order history: every buy and sell in the demat account, with the day it executed.
import {
  findCell,
  findDate,
  findHeader,
  labelled,
  lower,
  num,
  rangeEnd,
  rowsBelow,
  text,
} from '../../../import/sheet.ts';
import type { ImportDraft, Importer, InputFile } from '../../../import/types.ts';
import { defaultAssetClass } from '../../../model/classify.ts';
import { mask, normaliseName } from '../../../model/ids.ts';
import type { TransactionType } from '../../../model/types.ts';
import { roundAmount, roundPrice, roundUnits } from '../../../util/numbers.ts';
import { stockKind } from '../groww-stock-holdings/index.ts';

const HEADINGS = {
  name: ['stock name'],
  symbol: ['symbol'],
  isin: ['isin'],
  type: ['type'],
  quantity: ['quantity'],
  value: ['value'],
  exchange: ['exchange'],
  date: ['execution date and time'],
  status: ['order status'],
};

const TITLE = 'order history for stocks';
const TYPES: Record<string, TransactionType> = { buy: 'buy', sell: 'sell' };
/** Two letters, nine letters or digits, a check digit. Files shared for help may mask it ("INExxx"). */
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

async function ordersSheet(file: InputFile) {
  for (const sheet of await file.sheets()) {
    const header = findHeader(sheet.rows, HEADINGS);

    if (header) {
      return { rows: sheet.rows, header };
    }
  }

  return undefined;
}

export const growwStockOrders: Importer = {
  id: 'groww-stock-orders',
  version: 1,
  label: 'Groww stocks (order history)',
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

    // The same account as the holdings statement's, which carries the same client code.
    const code = text(labelled(rows, 'unique client code'));
    const maskedRef = code ? mask(code) : undefined;
    const account = 'demat';

    draft.accounts.push({
      ref: account,
      institution: 'Groww',
      kind: 'demat',
      label: `Groww demat ${maskedRef ?? ''}`.trim(),
      ...(maskedRef ? { maskedRef } : { byHolding: true }),
      currency: 'INR',
    });

    let orders = 0;
    let unread = 0;
    const otherTypes = new Set<string>();

    for (const row of rowsBelow(rows, header.row)) {
      const name = text(row[col.name]);

      if (!name) {
        continue;
      }

      orders += 1;

      // Cancelled, rejected and failed orders never traded.
      if (lower(row[col.status]) !== 'executed') {
        continue;
      }

      const type = TYPES[lower(row[col.type])];

      if (!type) {
        otherTypes.add(text(row[col.type]));
        continue;
      }

      const units = num(row[col.quantity]);
      const amount = num(row[col.value]);
      const date = findDate(row[col.date]);

      if (units === undefined || units <= 0 || amount === undefined || !date) {
        unread += 1;
        continue;
      }

      const given = text(row[col.isin]).toUpperCase();
      const isin = ISIN.test(given) ? given : '';
      const symbol = lower(row[col.exchange]) === 'nse' ? text(row[col.symbol]).toUpperCase() : '';
      const ref = isin ? `isin:${isin}` : `name:${normaliseName(name)}`;
      const known = draft.instruments.find((i) => i.ref === ref);

      if (!known) {
        const kind = stockKind(name, isin);

        draft.instruments.push({
          ref,
          kind,
          name,
          currency: 'INR',
          assetClass: defaultAssetClass(kind, name),
          ids: { ...(isin ? { isin } : {}), ...(symbol ? { nse: symbol } : {}) },
        });

        if (kind === 'sgb') {
          draft.warnings.push(`Add the issue date of ${name} to track its coupons`);
        }
      } else if (symbol && !known.ids.nse) {
        known.ids.nse = symbol;
      }

      draft.transactions.push({
        account,
        instrument: ref,
        date,
        type,
        units: roundUnits(units),
        price: roundPrice(amount / units),
        amount: roundAmount(amount),
        currency: 'INR',
      });
    }

    if (otherTypes.size > 0) {
      draft.warnings.push(`Left out orders of type ${[...otherTypes].join(', ')}`);
    }

    if (unread > 0) {
      draft.warnings.push(
        `${unread} ${unread === 1 ? "order couldn't" : "orders couldn't"} be read. Check them against the file.`,
      );
    }

    if (draft.transactions.length === 0) {
      draft.warnings.push(
        orders > 0 ? 'The file lists no executed orders' : 'The file lists no orders',
      );
    }

    return draft;
  },
};
