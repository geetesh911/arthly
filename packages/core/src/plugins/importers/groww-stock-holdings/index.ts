// SPDX-License-Identifier: AGPL-3.0-only
// Groww's stock holdings statement: stocks, ETFs and SGBs held in the demat account.
import {
  findCell,
  findDate,
  findHeader,
  labelled,
  lower,
  num,
  rowsBelow,
  text,
} from '../../../import/sheet.ts';
import type { ImportDraft, Importer, InputFile } from '../../../import/types.ts';
import { defaultAssetClass } from '../../../model/classify.ts';
import { mask } from '../../../model/ids.ts';
import type { InstrumentKind } from '../../../model/types.ts';
import { roundAmount, roundPrice, roundUnits } from '../../../util/numbers.ts';

const HEADINGS = {
  name: ['stock name', 'name'],
  isin: ['isin'],
  quantity: ['quantity', 'qty'],
  buyValue: ['buy value', 'invested value'],
  close: ['closing price'],
  value: ['closing value', 'current value'],
};

/** By name first, since some files carry placeholder ISINs; then by ISIN prefix. */
export function stockKind(name: string, isin: string): InstrumentKind {
  const n = name.toUpperCase();

  if (/GOLD ?BONDS?|\bSGB/.test(n)) {
    return 'sgb';
  }

  if (/\bETF\b|BEES\b|CASE\b|NETF|\bIETF/.test(n)) {
    return 'etf';
  }

  if (isin.startsWith('INF')) {
    return 'etf';
  }

  if (isin.startsWith('IN00')) {
    return 'bond';
  }

  return 'stock';
}

async function holdingsSheet(file: InputFile) {
  for (const sheet of await file.sheets()) {
    const header = findHeader(sheet.rows, HEADINGS);

    if (header) {
      return { rows: sheet.rows, header };
    }
  }

  return undefined;
}

export const growwStockHoldings: Importer = {
  id: 'groww-stock-holdings',
  version: 1,
  label: 'Groww stocks (holdings statement)',
  extensions: ['.xlsx', '.xls'],

  async detect(file) {
    const found = await holdingsSheet(file);

    if (!found) {
      return 0;
    }

    return findCell(found.rows, (t) => t.startsWith('holdings statement for stocks')) ? 0.95 : 0.65;
  },

  async parse(file) {
    const found = await holdingsSheet(file);

    if (!found) {
      throw new Error('No holdings table found');
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

    const titleAt = findCell(rows, (t) => t.startsWith('holdings statement for stocks'));
    const asOf = titleAt ? findDate(rows[titleAt.row]![titleAt.col]) : undefined;

    if (!asOf) {
      throw new Error('The file has no "as on" date');
    }

    draft.asOf = asOf;

    const code = text(labelled(rows, 'unique client code'));
    const maskedRef = code ? mask(code) : undefined;
    const account = 'demat';

    draft.accounts.push({
      ref: account,
      institution: 'Groww',
      kind: 'demat',
      label: `Groww demat ${maskedRef ?? ''}`.trim(),
      ...(maskedRef ? { maskedRef } : {}),
      currency: 'INR',
    });

    const invested = num(labelled(rows, 'invested value'));
    const value = num(labelled(rows, 'closing value'));

    draft.totals = {
      ...(invested !== undefined ? { invested } : {}),
      ...(value !== undefined ? { value } : {}),
    };

    for (const row of rowsBelow(rows, header.row)) {
      const name = text(row[col.name]);
      const isin = text(row[col.isin]).toUpperCase();
      const units = num(row[col.quantity]);

      if (!name || units === undefined || lower(row[col.name]) === 'total') {
        continue;
      }

      const kind = stockKind(name, isin);
      const ref = isin ? `isin:${isin}` : `name:${name}`;

      if (!draft.instruments.some((i) => i.ref === ref)) {
        draft.instruments.push({
          ref,
          kind,
          name,
          currency: 'INR',
          assetClass: defaultAssetClass(kind, name),
          ids: isin ? { isin } : {},
        });

        if (kind === 'sgb') {
          draft.warnings.push(`Add the issue date of ${name} to track its coupons`);
        }
      }

      const close = num(row[col.close]);
      const closingValue = num(row[col.value]);

      draft.snapshots.push({
        account,
        instrument: ref,
        asOf,
        units: roundUnits(units),
        ...(num(row[col.buyValue]) !== undefined
          ? { invested: roundAmount(num(row[col.buyValue])!) }
          : {}),
        ...(closingValue !== undefined ? { value: roundAmount(closingValue) } : {}),
        ...(close !== undefined ? { price: roundPrice(close) } : {}),
      });
    }

    if (draft.snapshots.length === 0) {
      draft.warnings.push('The file lists no holdings');
    }

    return draft;
  },
};
