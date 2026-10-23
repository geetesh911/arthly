// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { summary } from '../../engine/portfolio.ts';
import { PriceBook } from '../../engine/prices.ts';
import { Ledger } from '../../engine/testkit.ts';
import { applyPlan, pickImporter, planImport, upToDate } from '../../import/plan.ts';
import { inputFile, readSheets } from '../../import/sheet.ts';
import { type Event, importApplyEvent } from '../../log/events.ts';
import { formatHlc } from '../../log/hlc.ts';
import { replay, type State } from '../../log/replay.ts';
import { utf8 } from '../../util/bytes.ts';
import { importers } from '../importers/index.ts';

import { excelExporter, templateExporter } from './excel/index.ts';
import { jsonExporter } from './json/index.ts';

function sample(): Ledger {
  return new Ledger()
    .member('mem_1', 'Asha')
    .account({
      id: 'acc_1',
      kind: 'mf',
      institution: 'PPFAS Mutual Fund',
      label: 'PPFAS folio ••••5678',
      ref: '••••5678',
    })
    .account({ id: 'acc_2', kind: 'bank', institution: 'Bank of Baroda', label: 'BOB FDs' })
    .instrument({
      id: 'ins_1',
      kind: 'mf',
      name: 'Parag Parikh ELSS Tax Saver Fund Direct Growth',
      ids: { amfi: '147481', isin: 'INF879O01100' },
    })
    .instrument({
      id: 'ins_2',
      kind: 'fd',
      name: 'BOB FD 1',
      assetClass: 'debt',
      terms: {
        principal: 100_000,
        start: '2026-09-02',
        maturity: '2027-09-02',
        ratePct: 6.25,
        compounding: 'quarterly',
        payout: 'cumulative',
      },
    })
    .txn({ date: '2025-01-05', type: 'buy', units: 100.5, amount: 8_000, meta: { note: 'SIP' } })
    .txn({
      date: '2026-09-02',
      type: 'contribution',
      amount: 100_000,
      accountId: 'acc_2',
      instrumentId: 'ins_2',
    })
    .put('snapshot', {
      id: 'snp_1',
      accountId: 'acc_1',
      instrumentId: 'ins_1',
      asOf: '2026-10-21',
      units: 100.5,
      invested: 8_000,
      value: 9_039,
      source: { kind: 'manual' },
    })
    .put('group', { id: 'grp_1', name: 'Core', holdings: [{ instrumentId: 'ins_1' }] })
    .loan({ id: 'loan_1', due: '2026-12-01', note: 'For a laptop' })
    .entry('loan_1', 'advance', 20_000, '2026-06-01')
    .entry('loan_1', 'repayment', 5_000, '2026-08-01')
    .loan({ id: 'loan_2', direction: 'borrowed', party: 'Sample relative' })
    .entry('loan_2', 'advance', 50_000, '2026-03-01')
    .card({ id: 'card_1', limit: 100_000 })
    .bill('card_1', '2026-10-01', '2026-10-21', 12_000, 600)
    .payment('card_1', 600, '2026-10-05')
    .card({ id: 'card_2', bank: 'Other Bank', name: 'Shopping card', closed: '2026-09-30' })
    .bill('card_2', '2026-09-01', '2026-09-21', 3_000, 150)
    .payment('card_2', 3_000, '2026-09-10');
}

const book = new PriceBook([
  { key: 'amfi:147481', date: '2026-10-21', close: 30.81, currency: 'INR', source: 'test' },
]);

/** Every record, without its source: re-imported records belong to the new import. */
function records(state: State) {
  return Object.fromEntries(
    Object.entries(state.tables).map(([name, table]) => [
      name,
      [...table.values()]
        .map((v) => {
          const value = { ...(v.value as unknown as Record<string, unknown>) };

          delete value.source;

          return value;
        })
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    ]),
  );
}

async function reimport(name: string, bytes: Uint8Array, into: State) {
  const file = inputFile(name, bytes);
  const picked = await pickImporter(file, importers);

  expect(picked?.importer.id).toBe('template');
  const draft = await picked!.importer.parse(file, { memberId: 'mem_1', today: '2026-10-22' });

  expect(draft.warnings).toEqual([]);

  return planImport(into, draft, {
    importer: picked!.importer,
    file: { name, sha256: 'x', size: bytes.length },
    memberId: 'mem_1',
  });
}

function applied(plan: ReturnType<typeof planImport>): State {
  const events: Event[] = [
    importApplyEvent(formatHlc(1, 0, 'aaaaaaaa'), applyPlan(plan, 'bat_1')!),
  ];

  return replay(events);
}

describe('Excel export', () => {
  it('has reading tabs whose figures match the dashboard', async () => {
    const state = sample().state();
    const bytes = await excelExporter.run({ state, book, date: '2026-10-21' });
    const sheets = await readSheets(bytes);

    expect(sheets.map((s) => s.name)).toEqual([
      'Summary',
      'Holdings',
      'Transactions',
      'Income',
      'Coming up',
      'Monthly history',
      'Loans',
      'Cards',
      '_members',
      '_accounts',
      '_instruments',
      '_transactions',
      '_snapshots',
      '_groups',
      '_loans',
      '_loan_entries',
      '_cards',
      '_card_bills',
      '_card_payments',
    ]);
    const top = sheets[0]!.rows;
    const s = summary(state, book, '2026-10-21');

    expect(top.slice(3, 8)).toEqual([
      ['Net worth', s.netWorth],
      ['Investments', s.investments],
      ['Owed to you', 15_000],
      ['You owe', 50_000],
      ['Card dues', 11_400],
    ]);
    expect(s.netWorth).toBeCloseTo(s.investments - 35_000 - 11_400, 6);
    expect(sheets[6]!.rows.slice(1)).toEqual([
      [
        'Asha',
        'Owed to you',
        'Sample friend',
        20_000,
        5_000,
        0,
        15_000,
        '2026-12-01',
        'Open',
        'For a laptop',
      ],
      ['Asha', 'You owe', 'Sample relative', 50_000, 0, 0, 50_000, null, 'Open', null],
    ]);
    expect(sheets[7]!.rows.slice(1)).toEqual([
      [
        'Asha',
        'Sample Bank',
        'Travel card',
        100_000,
        '2026-10-01',
        '2026-10-21',
        12_000,
        600,
        600,
        11_400,
        'Minimum paid',
        null,
      ],
      [
        'Asha',
        'Other Bank',
        'Shopping card',
        null,
        '2026-09-01',
        '2026-09-21',
        3_000,
        150,
        3_000,
        0,
        'Paid',
        '2026-09-30',
      ],
    ]);
    expect(sheets[1]!.rows).toHaveLength(3);
    expect(sheets[2]!.rows).toHaveLength(3);
  });

  it('re-imports to the same records, and a second time changes nothing', async () => {
    const state = sample().state();
    const bytes = await excelExporter.run({ state, book, date: '2026-10-21' });
    const plan = await reimport('export.xlsx', bytes, replay([]));

    expect(records(applied(plan))).toEqual(records(state));
    expect(upToDate(await reimport('export.xlsx', bytes, state))).toBe(true);
  });
});

describe('JSON export', () => {
  it('re-imports to the same records', async () => {
    const state = sample().state();
    const bytes = await jsonExporter.run({ state, book, date: '2026-10-21' });
    const parsed = JSON.parse(utf8.decode(bytes));

    expect(parsed).toMatchObject({ format: 'portfolio-export', version: 1 });
    expect(records(applied(await reimport('export.json', bytes, replay([]))))).toEqual(
      records(state),
    );
  });
});

describe('template', () => {
  it('has only the data tabs and a read-me', async () => {
    const bytes = await templateExporter.run({ state: sample().state(), book, date: '2026-10-21' });
    const sheets = await readSheets(bytes);

    expect(sheets.map((s) => s.name)).toEqual([
      '_members',
      '_accounts',
      '_instruments',
      '_transactions',
      '_snapshots',
      '_groups',
      '_loans',
      '_loan_entries',
      '_cards',
      '_card_bills',
      '_card_payments',
      'Read me',
    ]);
    expect(sheets.slice(0, 11).every((s) => s.rows.length === 1)).toBe(true);
  });

  it('creates records from rows without IDs, the same ones each time', async () => {
    const csv = [
      'id,accountId,instrumentId,date,type,units,amount,currency',
      ',acc_1,ins_1,2026-01-05,buy,10,1000,INR',
      ',acc_1,ins_1,2026-01-05,buy,10,1000,INR',
      ',acc_1,ins_1,2026-13-01,buy,10,1000,INR',
    ].join('\n');
    const file = inputFile('transactions.csv', utf8.encode(csv));
    const picked = await pickImporter(file, importers);

    expect(picked?.importer.id).toBe('template');
    const draft = await picked!.importer.parse(file, { memberId: 'mem_1', today: '2026-10-22' });

    expect(draft.warnings).toEqual(['Row 4 on Sheet1: "2026-13-01" is not a YYYY-MM-DD date']);
    expect(draft.records).toHaveLength(2);
    expect(new Set(draft.records!.map((r) => r.id)).size).toBe(2);
    const again = await picked!.importer.parse(file, { memberId: 'mem_1', today: '2026-10-22' });

    expect(again.records!.map((r) => r.id)).toEqual(draft.records!.map((r) => r.id));
  });
});
