// SPDX-License-Identifier: AGPL-3.0-only
// Groww's mutual-fund holdings Excel: one row per scheme and folio, plus a summary block.
import { findCell, findDate, findHeader, num, rowsBelow, text } from '../../../import/sheet.ts';
import type { ImportDraft, Importer, InputFile } from '../../../import/types.ts';
import { defaultAssetClass } from '../../../model/classify.ts';
import { mask, normaliseName } from '../../../model/ids.ts';
import { roundAmount, roundUnits } from '../../../util/numbers.ts';

const HEADINGS = {
  scheme: ['scheme name'],
  amc: ['amc'],
  category: ['category'],
  subCategory: ['sub-category', 'sub category'],
  folio: ['folio no.', 'folio no', 'folio number', 'folio'],
  units: ['units'],
  invested: ['invested value', 'invested amount'],
  value: ['current value'],
};

async function holdingsSheet(file: InputFile) {
  for (const sheet of await file.sheets()) {
    const header = findHeader(sheet.rows, HEADINGS);
    if (header) return { rows: sheet.rows, header };
  }
  return undefined;
}

export const growwMfHoldings: Importer = {
  id: 'groww-mf-holdings',
  version: 1,
  label: 'Groww mutual funds (holdings Excel)',
  extensions: ['.xlsx', '.xls'],

  async detect(file) {
    const found = await holdingsSheet(file);
    if (!found) return 0;
    return findCell(found.rows, (t) => t.startsWith('holdings as on')) ? 0.95 : 0.7;
  },

  async parse(file) {
    const found = await holdingsSheet(file);
    if (!found) throw new Error('No holdings table found');
    const { rows, header } = found;
    const { col } = header;
    const draft: ImportDraft = {
      accounts: [],
      instruments: [],
      transactions: [],
      snapshots: [],
      warnings: [],
    };

    const asOfCell = findCell(rows, (t) => t.startsWith('holdings as on'));
    const asOf = asOfCell ? findDate(rows[asOfCell.row]![asOfCell.col]) : undefined;
    if (!asOf) throw new Error('The file has no "HOLDINGS AS ON" date');
    draft.asOf = asOf;

    const totalsHead = findHeader(rows, {
      invested: ['total investments'],
      value: ['current portfolio value'],
    });
    if (totalsHead) {
      const values = rows[totalsHead.row + 1] ?? [];
      const invested = num(values[totalsHead.col.invested]);
      const value = num(values[totalsHead.col.value]);
      draft.totals = {
        ...(invested !== undefined ? { invested } : {}),
        ...(value !== undefined ? { value } : {}),
      };
    }

    // Rows for the same scheme in the same folio are one holding.
    const holdings = new Map<
      string,
      { units: number; invested: number; value: number; account: string; instrument: string }
    >();
    for (const row of rowsBelow(rows, header.row)) {
      const scheme = text(row[col.scheme]);
      const amc = text(row[col.amc]);
      const folio = text(row[col.folio]);
      const units = num(row[col.units]);
      if (!scheme || units === undefined) continue;
      const maskedRef = folio ? mask(folio) : undefined;
      const account = `folio:${normaliseName(amc)}:${maskedRef ?? ''}`;
      if (!draft.accounts.some((a) => a.ref === account)) {
        draft.accounts.push({
          ref: account,
          institution: amc || 'Mutual fund',
          kind: 'mf',
          label: `${amc || 'Mutual fund'} folio ${maskedRef ?? ''}`.trim(),
          ...(maskedRef ? { maskedRef } : {}),
          currency: 'INR',
        });
      }
      const instrument = `scheme:${normaliseName(scheme)}`;
      if (!draft.instruments.some((i) => i.ref === instrument)) {
        const category = text(row[col.category]);
        const subCategory = text(row[col.subCategory]);
        draft.instruments.push({
          ref: instrument,
          kind: 'mf',
          name: scheme,
          currency: 'INR',
          assetClass: defaultAssetClass('mf', scheme, `${category} ${subCategory}`),
          ids: {},
          hints: { amc, category, subCategory },
        });
      }
      const key = `${account}|${instrument}`;
      const h = holdings.get(key) ?? { units: 0, invested: 0, value: 0, account, instrument };
      h.units += units;
      h.invested += num(row[col.invested]) ?? 0;
      h.value += num(row[col.value]) ?? 0;
      holdings.set(key, h);
    }

    for (const h of holdings.values()) {
      const units = roundUnits(h.units);
      draft.snapshots.push({
        account: h.account,
        instrument: h.instrument,
        asOf,
        units,
        invested: roundAmount(h.invested),
        value: roundAmount(h.value),
      });
    }
    if (draft.snapshots.length === 0) draft.warnings.push('The file lists no holdings');
    return draft;
  },
};
