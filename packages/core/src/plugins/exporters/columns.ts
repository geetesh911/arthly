// SPDX-License-Identifier: AGPL-3.0-only
// The template format: one data tab per entity, one column per field, nested fields dotted.
// The Excel export writes it and the template importer reads it.
import type { EntityMap, EntityName } from '../../model/types.ts';

export type ColumnType = 'text' | 'number' | 'json';

export interface Column {
  key: string;
  type: ColumnType;
}

const text = (key: string): Column => ({ key, type: 'text' });
const number = (key: string): Column => ({ key, type: 'number' });
const json = (key: string): Column => ({ key, type: 'json' });

export const DATA_TABS: Partial<Record<EntityName, { tab: string; columns: Column[] }>> = {
  member: { tab: '_members', columns: [text('id'), text('name')] },
  account: {
    tab: '_accounts',
    columns: [
      text('id'),
      text('memberId'),
      text('institution'),
      text('kind'),
      text('label'),
      text('ref'),
      text('currency'),
    ],
  },
  instrument: {
    tab: '_instruments',
    columns: [
      text('id'),
      text('kind'),
      text('name'),
      text('currency'),
      text('assetClass'),
      text('ids.isin'),
      text('ids.amfi'),
      text('ids.nse'),
      text('ids.bse'),
      text('ids.us'),
      number('terms.principal'),
      text('terms.start'),
      text('terms.maturity'),
      number('terms.ratePct'),
      text('terms.compounding'),
      text('terms.payout'),
      number('terms.faceValue'),
      number('terms.couponPct'),
      number('terms.couponFreq'),
      text('terms.issue'),
      text('terms.opened'),
    ],
  },
  transaction: {
    tab: '_transactions',
    columns: [
      text('id'),
      text('accountId'),
      text('instrumentId'),
      text('date'),
      text('type'),
      number('units'),
      number('price'),
      number('amount'),
      text('currency'),
      number('fx'),
      json('meta'),
      text('source'),
    ],
  },
  snapshot: {
    tab: '_snapshots',
    columns: [
      text('id'),
      text('accountId'),
      text('instrumentId'),
      text('asOf'),
      number('units'),
      number('invested'),
      number('value'),
      number('price'),
      text('source'),
    ],
  },
  group: { tab: '_groups', columns: [text('id'), text('name'), json('holdings')] },
};

export type DataEntity = keyof typeof DATA_TABS & EntityName;

export const DATA_ENTITIES = Object.keys(DATA_TABS) as DataEntity[];

function getPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
      value,
    );
}

/** One entity as a row of cells. The source becomes "manual" or "import:<batchId>". */
export function toRow(
  entity: DataEntity,
  value: EntityMap[DataEntity],
): (string | number | null)[] {
  return DATA_TABS[entity]!.columns.map(({ key, type }) => {
    let v = getPath(value, key);
    if (key === 'source' && v && typeof v === 'object') {
      const s = v as { kind: string; batchId?: string };
      v = s.kind === 'import' ? `import:${s.batchId}` : 'manual';
    }
    if (v === undefined || v === null) return null;
    if (type === 'json') return JSON.stringify(v);
    return type === 'number' ? Number(v) : String(v);
  });
}

/** A row of cells back into a plain object; blank cells are left out. */
export function fromRow(
  entity: DataEntity,
  headings: string[],
  cells: unknown[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const columns = new Map(DATA_TABS[entity]!.columns.map((c) => [c.key, c]));
  headings.forEach((heading, i) => {
    const column = columns.get(heading);
    const raw = cells[i];
    if (!column || raw === null || raw === undefined || String(raw).trim() === '') return;
    let v: unknown;
    if (column.type === 'number') {
      v = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,₹\s]/g, ''));
      if (!Number.isFinite(v)) return;
    } else if (column.type === 'json') {
      try {
        v = JSON.parse(String(raw));
      } catch {
        return;
      }
    } else {
      v = String(raw).trim();
    }
    const path = heading.split('.');
    let target = out;
    for (const part of path.slice(0, -1)) target = (target[part] ??= {}) as Record<string, unknown>;
    target[path.at(-1)!] = v;
  });
  return out;
}
