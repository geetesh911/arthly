// SPDX-License-Identifier: AGPL-3.0-only
// Reads the app's own files back: the Excel export's data tabs, the blank template, a CSV of one
// data tab, or the JSON export. Rows with an ID update that record; rows without one create a
// record whose ID comes from its contents, so importing twice changes nothing. Nothing is deleted.
import type { Put } from '../../../log/events.ts';
import { defaultAssetClass } from '../../../model/classify.ts';
import {
  accountId,
  hashId,
  importedTransactionId,
  instrumentId,
  normaliseName,
  snapshotId,
} from '../../../model/ids.ts';
import type { EntityMap, InstrumentKind, Source, TransactionType } from '../../../model/types.ts';
import { lower, text } from '../../../import/sheet.ts';
import type { ImportDraft, Importer, InputFile, Sheet } from '../../../import/types.ts';
import { utf8 } from '../../../util/bytes.ts';
import { isISODate } from '../../../util/dates.ts';
import { roundAmount } from '../../../util/numbers.ts';
import { DATA_ENTITIES, DATA_TABS, fromRow, type DataEntity } from '../../exporters/columns.ts';
import type { JsonExport } from '../../exporters/json/index.ts';

const KINDS: InstrumentKind[] = [
  'stock',
  'etf',
  'mf',
  'sgb',
  'bond',
  'fd',
  'ppf',
  'epf',
  'eps',
  'cash',
  'us-stock',
  'other',
];
const TYPES: TransactionType[] = [
  'opening',
  'buy',
  'sell',
  'switch-in',
  'switch-out',
  'dividend',
  'dividend-reinvest',
  'interest',
  'contribution',
  'withdrawal',
  'maturity',
  'bonus',
  'split',
  'charge',
  'tax',
];
const TERMS: Record<string, string[]> = {
  fd: ['principal', 'start', 'maturity', 'ratePct', 'compounding', 'payout'],
  bond: ['faceValue', 'couponPct', 'couponFreq', 'issue', 'maturity'],
  sgb: ['faceValue', 'couponPct', 'couponFreq', 'issue', 'maturity'],
  ppf: ['opened'],
};

/** The data tab a sheet holds: by its name, or for a CSV by its headings. */
function entityOf(sheet: Sheet, csv: boolean): DataEntity | undefined {
  const byName = DATA_ENTITIES.find((e) => DATA_TABS[e]!.tab === sheet.name.trim().toLowerCase());
  if (byName) return byName;
  if (!csv) return undefined;
  const headings = (sheet.rows[0] ?? []).map(lower);
  return DATA_ENTITIES.find((e) => {
    const keys = DATA_TABS[e]!.columns.map((c) => c.key.toLowerCase());
    return headings.includes('id') && headings.filter(Boolean).every((h) => keys.includes(h));
  });
}

function parseSource(v: unknown): Source {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('import:') ? { kind: 'import', batchId: s.slice(7) } : { kind: 'manual' };
}

type Row = Record<string, unknown>;

/** Checks a row and fills in defaults and IDs. Returns an error message for a bad row. */
function complete(entity: DataEntity, row: Row, n: number): EntityMap[DataEntity] | string {
  const str = (k: string) => (typeof row[k] === 'string' ? (row[k] as string) : undefined);
  const num = (k: string) => (typeof row[k] === 'number' ? (row[k] as number) : undefined);
  const id = str('id');
  switch (entity) {
    case 'member': {
      const name = str('name');
      if (!name) return 'a member needs a name';
      return { id: id ?? hashId('mem', [normaliseName(name)]), name };
    }
    case 'account': {
      const memberId = str('memberId');
      const institution = str('institution');
      const kind = str('kind') as EntityMap['account']['kind'] | undefined;
      if (!memberId || !institution || !kind)
        return 'an account needs memberId, institution and kind';
      if (!['demat', 'mf', 'bank', 'ppf', 'epf', 'other'].includes(kind))
        return `unknown account kind "${kind}"`;
      const ref = str('ref');
      return {
        id: id ?? accountId({ memberId, institution, kind, ...(ref ? { ref } : {}) }),
        memberId,
        institution,
        kind,
        label: str('label') ?? institution,
        ...(ref ? { ref } : {}),
        currency: str('currency') === 'USD' ? 'USD' : 'INR',
      };
    }
    case 'instrument': {
      const kind = str('kind') as InstrumentKind | undefined;
      const name = str('name');
      if (!kind || !name) return 'an instrument needs kind and name';
      if (!KINDS.includes(kind)) return `unknown instrument kind "${kind}"`;
      const ids = Object.fromEntries(
        Object.entries((row.ids as Row | undefined) ?? {})
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
          .map(([k, v]) => [k, String(v)]),
      );
      const rawTerms = (row.terms as Row | undefined) ?? {};
      const wanted = TERMS[kind] ?? [];
      const terms = Object.fromEntries(
        wanted.filter((k) => rawTerms[k] !== undefined).map((k) => [k, rawTerms[k]]),
      );
      const hasTerms = wanted.length > 0 && wanted.every((k) => terms[k] !== undefined);
      return {
        id: id ?? instrumentId(ids, name),
        kind,
        name,
        currency: str('currency') === 'USD' ? 'USD' : 'INR',
        assetClass:
          (str('assetClass') as EntityMap['instrument']['assetClass']) ??
          defaultAssetClass(kind, name),
        ids,
        ...(hasTerms
          ? { terms: terms as unknown as NonNullable<EntityMap['instrument']['terms']> }
          : {}),
      };
    }
    case 'transaction': {
      const [account, instrument, date, type, amount] = [
        str('accountId'),
        str('instrumentId'),
        str('date'),
        str('type'),
        num('amount'),
      ];
      if (!account || !instrument || !date || !type || amount === undefined) {
        return 'a transaction needs accountId, instrumentId, date, type and amount';
      }
      if (!isISODate(date)) return `"${date}" is not a YYYY-MM-DD date`;
      if (!TYPES.includes(type as TransactionType)) return `unknown transaction type "${type}"`;
      const units = num('units');
      const base = {
        accountId: account,
        instrumentId: instrument,
        date,
        type: type as TransactionType,
        amount: Math.abs(amount),
        ...(units !== undefined ? { units } : {}),
      };
      const meta =
        row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, string>) : undefined;
      return {
        id: id ?? importedTransactionId(base, n),
        ...base,
        amount: roundAmount(Math.abs(amount)),
        ...(num('price') !== undefined ? { price: num('price')! } : {}),
        currency: str('currency') === 'USD' ? 'USD' : 'INR',
        ...(num('fx') !== undefined ? { fx: num('fx')! } : {}),
        ...(meta ? { meta } : {}),
        source: parseSource(row.source),
      };
    }
    case 'snapshot': {
      const [account, instrument, asOf, units] = [
        str('accountId'),
        str('instrumentId'),
        str('asOf'),
        num('units'),
      ];
      if (!account || !instrument || !asOf || units === undefined)
        return 'a snapshot needs accountId, instrumentId, asOf and units';
      if (!isISODate(asOf)) return `"${asOf}" is not a YYYY-MM-DD date`;
      return {
        id: id ?? snapshotId({ accountId: account, instrumentId: instrument, asOf }),
        accountId: account,
        instrumentId: instrument,
        asOf,
        units,
        ...(num('invested') !== undefined ? { invested: num('invested')! } : {}),
        ...(num('value') !== undefined ? { value: num('value')! } : {}),
        ...(num('price') !== undefined ? { price: num('price')! } : {}),
        source: parseSource(row.source),
      };
    }
    case 'group': {
      const name = str('name');
      if (!name) return 'a group needs a name';
      const holdings = Array.isArray(row.holdings)
        ? (row.holdings as EntityMap['group']['holdings'])
        : [];
      return { id: id ?? hashId('grp', [normaliseName(name)]), name, holdings };
    }
  }
  return 'unknown record';
}

function rowsToRecords(
  entity: DataEntity,
  headings: string[],
  rows: unknown[][],
  draft: ImportDraft,
  label: string,
) {
  const seen = new Map<string, number>();
  rows.forEach((cells, index) => {
    if (cells.every((c) => text(c as never) === '')) return;
    const row = fromRow(entity, headings, cells);
    const signature = JSON.stringify(row);
    const n = seen.get(signature) ?? 0;
    seen.set(signature, n + 1);
    const value = complete(entity, row, n);
    if (typeof value === 'string') {
      draft.warnings.push(`Row ${index + 2} on ${label}: ${value}`);
      return;
    }
    draft.records!.push({ entity, id: value.id, value } as Put);
  });
}

async function readJson(file: InputFile): Promise<JsonExport | undefined> {
  if (!file.name.toLowerCase().endsWith('.json')) return undefined;
  try {
    const data = JSON.parse(utf8.decode(file.bytes)) as JsonExport;
    return data?.format === 'portfolio-export' ? data : undefined;
  } catch {
    return undefined;
  }
}

export const template: Importer = {
  id: 'template',
  version: 1,
  label: "This app's Excel export, template or JSON export",
  extensions: ['.xlsx', '.xls', '.csv', '.json'],

  async detect(file) {
    if (await readJson(file)) return 0.99;
    const csv = file.name.toLowerCase().endsWith('.csv');
    const sheets = await file.sheets();
    return sheets.some((s) => entityOf(s, csv) && (s.rows[0] ?? []).map(lower).includes('id'))
      ? 0.99
      : 0;
  },

  async parse(file) {
    const draft: ImportDraft = {
      accounts: [],
      instruments: [],
      transactions: [],
      snapshots: [],
      records: [],
      warnings: [],
    };
    const json = await readJson(file);
    if (json) {
      if (json.version > 1) throw new Error('This file was made by a newer version of the app');
      for (const entity of DATA_ENTITIES) {
        const list = (json.entities[entity] ?? []) as unknown as Row[];
        const headings = DATA_TABS[entity]!.columns.map((c) => c.key);
        const flat = list.map((value) =>
          headings.map((h) => {
            const v = h
              .split('.')
              .reduce<unknown>(
                (o, k) => (o && typeof o === 'object' ? (o as Row)[k] : undefined),
                value,
              );
            if (h === 'source' && v && typeof v === 'object') {
              const s = v as { kind: string; batchId?: string };
              return s.kind === 'import' ? `import:${s.batchId}` : 'manual';
            }
            return v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : v;
          }),
        );
        rowsToRecords(entity, headings, flat, draft, entity);
      }
      return draft;
    }
    const csv = file.name.toLowerCase().endsWith('.csv');
    for (const sheet of await file.sheets()) {
      const entity = entityOf(sheet, csv);
      if (!entity) continue;
      const headings = (sheet.rows[0] ?? []).map((c) => text(c));
      rowsToRecords(entity, headings, sheet.rows.slice(1), draft, sheet.name);
    }
    return draft;
  },
};
