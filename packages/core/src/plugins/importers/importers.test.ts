// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checks } from '../../engine/checks.ts';
import { evaluate, summary } from '../../engine/portfolio.ts';
import { PriceBook } from '../../engine/prices.ts';
import { readPdf } from '../../import/pdf-node.ts';
import { applyPlan, pickImporter, planImport, sha256Hex, upToDate } from '../../import/plan.ts';
import { inputFile } from '../../import/sheet.ts';
import type { Cell, ImportContext, Importer, InputFile } from '../../import/types.ts';
import { type Event, importApplyEvent, putEvent } from '../../log/events.ts';
import { formatHlc } from '../../log/hlc.ts';
import { all, replay } from '../../log/replay.ts';

import { bobPpfStatement } from './bob-ppf-statement/index.ts';
import { epfoPassbook } from './epfo-passbook/index.ts';
import { growwMfHoldings } from './groww-mf-holdings/index.ts';
import { growwMfOrders } from './groww-mf-orders/index.ts';
import { growwStockHoldings } from './groww-stock-holdings/index.ts';
import { growwStockOrders } from './groww-stock-orders/index.ts';
import { importers } from './index.ts';

const here = import.meta.dirname;
const fixture = (path: string) =>
  inputFile(path.split('/').pop()!, new Uint8Array(readFileSync(join(here, path))), readPdf);
const mfFile = () => fixture('groww-mf-holdings/fixtures/holdings.xlsx');
const stockFile = () => fixture('groww-stock-holdings/fixtures/holdings.xlsx');
const mfOrdersFile = () => fixture('groww-mf-orders/fixtures/orders.xlsx');
const stockOrdersFile = () => fixture('groww-stock-orders/fixtures/orders.xlsx');
const ppfFile = () => fixture('bob-ppf-statement/fixtures/statement.xlsx');
const epfFile = () => fixture('epfo-passbook/fixtures/passbook.pdf');
const ctx: ImportContext = { memberId: 'mem_1', today: '2026-10-22' };

/** A one-sheet file built from rows, for layouts too small to keep as fixtures. */
const sheetFile = (name: string, rows: Cell[][]): InputFile => ({
  name,
  bytes: new Uint8Array(),
  sheets: async () => [{ name: 'Sheet1', rows }],
  pdfText: async () => [],
});

/** Plans a file against a vault. */
async function planFile(state: ReturnType<typeof replay>, file: InputFile, importer: Importer) {
  return planImport(state, await importer.parse(file, ctx), {
    importer: { id: importer.id, version: importer.version },
    file: { name: file.name, sha256: await sha256Hex(file.bytes), size: file.bytes.length },
    memberId: 'mem_1',
  });
}

/** Imports each file in turn into an empty vault. */
async function importAll(files: [InputFile, Importer][]) {
  const events: Event[] = [
    putEvent(formatHlc(1, 0, 'aaaaaaaa'), 'member', { id: 'mem_1', name: 'Asha' }),
  ];

  for (const [n, [file, importer]] of files.entries()) {
    const plan = await planFile(replay(events), file, importer);

    events.push(
      importApplyEvent(formatHlc(n + 2, 0, 'aaaaaaaa'), applyPlan(plan, `bat_${n + 1}`)!),
    );
  }

  return replay(events);
}

/** Imports a file into an empty vault, then plans the same file again. */
async function importTwice(file: InputFile, importer: Importer) {
  const first = await planFile(replay([]), file, importer);
  const state = await importAll([[file, importer]]);
  const again = await planFile(state, file, importer);

  return { first, state, again };
}

function fixtures(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return fixtures(path);
    }

    return path.includes('/fixtures/') && /\.(xlsx|xls|csv|pdf)$/.test(path)
      ? [path.slice(here.length + 1)]
      : [];
  });
}

describe('picking an importer', () => {
  it('recognises each Groww file by its headings', async () => {
    expect((await pickImporter(mfFile(), importers))?.importer.id).toBe('groww-mf-holdings');
    expect((await pickImporter(stockFile(), importers))?.importer.id).toBe('groww-stock-holdings');
    expect(await growwMfHoldings.detect(stockFile())).toBe(0);
    expect(await growwStockHoldings.detect(mfFile())).toBe(0);
    expect((await pickImporter(mfOrdersFile(), importers))?.importer.id).toBe('groww-mf-orders');
    expect((await pickImporter(stockOrdersFile(), importers))?.importer.id).toBe(
      'groww-stock-orders',
    );

    for (const file of [mfOrdersFile(), stockOrdersFile()]) {
      expect(await growwMfHoldings.detect(file)).toBe(0);
      expect(await growwStockHoldings.detect(file)).toBe(0);
    }

    for (const file of [mfFile(), stockFile()]) {
      expect(await growwMfOrders.detect(file)).toBe(0);
      expect(await growwStockOrders.detect(file)).toBe(0);
    }

    expect(await pickImporter(inputFile('notes.pdf', new Uint8Array()), importers)).toBeNull();
  });
});

describe('groww-mf-holdings', () => {
  it('parses holdings, one per scheme and folio, and the file totals', async () => {
    const draft = await growwMfHoldings.parse(mfFile(), ctx);

    expect(draft.asOf).toBe('2026-10-21');
    expect(draft.totals).toEqual({ invested: 1_025_000, value: 1_094_818.5 });
    expect(draft.snapshots).toHaveLength(6);
    expect(draft.accounts.map((a) => a.label)).toContain('PPFAS Mutual Fund folio ••••5678');
    const ppfas = draft.snapshots.find((s) => s.instrument.includes('parag'))!;

    // Its two rows' XIRRs, 12.1% on ₹80,000 and 9.4% on ₹40,000, weighted by what went in.
    expect(ppfas).toMatchObject({
      units: 1500.75,
      invested: 120_000,
      value: 135_067.75,
      xirr: 0.112,
    });
    expect(draft.snapshots.find((s) => s.instrument.includes('tata'))?.xirr).toBeUndefined();
    expect(draft.instruments.find((i) => i.name.includes('Corporate Bond'))?.assetClass).toBe(
      'debt',
    );
    await expect(JSON.stringify(draft, null, 2)).toMatchFileSnapshot(
      'groww-mf-holdings/fixtures/holdings.draft.json',
    );
  });
});

describe('groww-stock-holdings', () => {
  it('parses stocks, ETFs and SGBs with their asset classes', async () => {
    const draft = await growwStockHoldings.parse(stockFile(), ctx);

    expect(draft.asOf).toBe('2026-10-20');
    expect(draft.accounts).toEqual([
      {
        ref: 'demat',
        institution: 'Groww',
        kind: 'demat',
        label: 'Groww demat ••••5432',
        maskedRef: '••••5432',
        currency: 'INR',
      },
    ]);
    expect(draft.instruments.map((i) => [i.kind, i.assetClass])).toEqual([
      ['sgb', 'gold'],
      ['etf', 'equity'],
      ['etf', 'silver'],
      ['etf', 'gold'],
      ['etf', 'cash'],
      ['stock', 'equity'],
    ]);
    expect(draft.totals).toEqual({ invested: 132_730, value: 196_620 });
    expect(draft.warnings).toEqual([
      'Add the issue date of 2.50%GOLDBONDS2032SR-IV to track its coupons',
    ]);
    await expect(JSON.stringify(draft, null, 2)).toMatchFileSnapshot(
      'groww-stock-holdings/fixtures/holdings.draft.json',
    );
  });
});

describe('groww-mf-orders', () => {
  /** A fund order file in Groww's layout, with the given rows. */
  const orders = (rows: Cell[][]) =>
    sheetFile('Mutual_Funds_Order_History.xlsx', [
      ['TRANSACTIONS FROM Apr 01 2026 TO Oct 21 2026'],
      ['Scheme Name', 'Transaction Type', 'Units', 'NAV', 'Amount', 'Date'],
      ...rows,
    ]);

  it('reads purchases and redemptions with their units, NAV and date', async () => {
    const draft = await growwMfOrders.parse(mfOrdersFile(), ctx);

    expect(draft.asOf).toBe('2026-10-21');
    // No folio in the file: each fund's orders go to the folio that already holds it.
    expect(draft.accounts).toEqual([
      {
        ref: 'groww',
        institution: 'Groww',
        kind: 'mf',
        label: 'Groww mutual funds',
        currency: 'INR',
        byHolding: true,
      },
    ]);
    expect(draft.instruments).toHaveLength(5);
    expect(
      draft.transactions.slice(0, 3).map((t) => [t.date, t.type, t.units, t.price, t.amount]),
    ).toEqual([
      ['2026-08-20', 'sell', 500, 146.8, 73_400],
      ['2025-07-10', 'buy', 1500, 30, 45_000],
      ['2025-01-05', 'buy', 1500.123, 99.9918, 150_000],
    ]);
    expect(draft.transactions).toHaveLength(9);
    expect(draft.warnings).toEqual([]);
    await expect(JSON.stringify(draft, null, 2)).toMatchFileSnapshot(
      'groww-mf-orders/fixtures/orders.draft.json',
    );
  });

  it('puts each fund in the folio holding it, so the holdings file then agrees', async () => {
    const state = await importAll([
      [mfFile(), growwMfHoldings],
      [mfOrdersFile(), growwMfOrders],
    ]);
    const holdings = evaluate(state, new PriceBook([], [], all(state, 'snapshot')), '2026-10-21');
    const held = (name: string) => holdings.find((h) => h.instrument.name.startsWith(name))!;

    expect(held('Parag').account.label).toBe('PPFAS Mutual Fund folio ••••5678');
    expect(held('Parag').position.units).toBeCloseTo(1500.75, 6);
    expect(held('Parag').position.estimate).toBe(false);
    expect(held('Tata').position.units).toBeCloseTo(3000.123, 6);
    expect(held('SBI').account.label).toBe('SBI Mutual Fund folio ••••7890');
    // A fund sold before the holdings file was made is in no folio, so it gets its own account.
    expect(held('Quant')).toMatchObject({ account: { label: 'Groww mutual funds' } });
    expect(held('Quant').position.units).toBe(0);
    expect(all(state, 'account')).toHaveLength(7);

    const holdingsAgain = await planFile(state, mfFile(), growwMfHoldings);

    expect(upToDate(holdingsAgain)).toBe(true);
    expect(holdingsAgain.items.filter((i) => i.mismatch)).toEqual([]);
    expect(upToDate(await planFile(state, mfOrdersFile(), growwMfOrders))).toBe(true);
  });

  it('says where funds no folio holds yet go, and imports once', async () => {
    const { first, again } = await importTwice(mfOrdersFile(), growwMfOrders);

    expect(first.items.filter((i) => i.put.entity === 'account')).toHaveLength(1);
    // The sold fund isn't counted: it needs no folio.
    expect(first.warnings).toEqual([
      "4 holdings aren't in any account yet, so they go to a new one, Groww mutual funds. To keep them with your holdings, import the holdings file before this one.",
    ]);
    expect(upToDate(again)).toBe(true);
    expect(again.warnings).toEqual([]);
  });

  it('names the folio it picks for a fund held in two', async () => {
    const state = await importAll([[mfFile(), growwMfHoldings]]);
    const plan = await planFile(
      state,
      orders([
        ['Axis Midcap Fund Direct Growth', 'PURCHASE', '10.000', '100.00', '1,000', '12 Oct 2026'],
      ]),
      growwMfOrders,
    );
    const txn = plan.items.find((i) => i.put.entity === 'transaction')!.put.value as {
      accountId: string;
    };

    expect(plan.warnings).toEqual([
      'Axis Midcap Fund Direct Growth is held in 2 accounts, so all its lines go to Axis Mutual Fund folio ••••3401.',
    ]);
    expect(txn.accountId).toBe(
      all(state, 'account').find((a) => a.label === 'Axis Mutual Fund folio ••••3401')!.id,
    );
    expect(plan.items.some((i) => i.put.entity === 'account')).toBe(false);
  });

  it('leaves out types it does not know, and rows it cannot read', async () => {
    const draft = await growwMfOrders.parse(
      orders([
        ['Axis Midcap Fund Direct Growth', 'SWITCH_IN', '10.000', '100.00', '1,000', '12 Oct 2026'],
        ['Axis Midcap Fund Direct Growth', 'BONUS', '5.000', '0', '0', '13 Oct 2026'],
        ['Axis Midcap Fund Direct Growth', 'PURCHASE', '', '100.00', '1,000', '14 Oct 2026'],
      ]),
      ctx,
    );

    expect(draft.transactions.map((t) => t.type)).toEqual(['switch-in']);
    expect(draft.warnings).toEqual([
      'Left out transactions of type BONUS',
      "1 transaction couldn't be read. Check them against the file.",
    ]);
  });
});

describe('groww-stock-orders', () => {
  const HEADER = [
    'Stock name',
    'Symbol',
    'ISIN',
    'Type',
    'Quantity',
    'Value',
    'Exchange',
    'Exchange Order Id',
    'Execution date and time',
    'Order status',
  ];

  it('reads executed buys and sells into the same demat account as the holdings', async () => {
    const draft = await growwStockOrders.parse(stockOrdersFile(), ctx);
    const holdings = await growwStockHoldings.parse(stockFile(), ctx);

    expect(draft.asOf).toBe('2026-10-20');
    expect(draft.accounts).toEqual(holdings.accounts);
    // The cancelled order is left out; an order on BSE adds no NSE symbol.
    expect(
      draft.transactions.map((t) => [t.instrument, t.date, t.type, t.units, t.amount]),
    ).toEqual([
      ['isin:INE002A01018', '2025-03-12', 'buy', 2, 2_600],
      ['isin:INE155A01022', '2025-02-05', 'sell', 10, 9_500],
      ['isin:INF0000TST01', '2024-01-10', 'buy', 50, 12_500],
      ['isin:INE002A01018', '2023-06-15', 'buy', 3, 3_900],
      ['isin:INE155A01022', '2022-04-20', 'buy', 10, 4_800],
    ]);
    expect(draft.transactions[0]!.price).toBe(1_300);
    expect(draft.instruments.map((i) => [i.kind, i.ids])).toEqual([
      ['stock', { isin: 'INE002A01018', nse: 'RELIANCE' }],
      ['stock', { isin: 'INE155A01022', nse: 'TATAMOTORS' }],
      ['etf', { isin: 'INF0000TST01', nse: 'NIFTYBEES' }],
    ]);
    expect(draft.warnings).toEqual([]);
    await expect(JSON.stringify(draft, null, 2)).toMatchFileSnapshot(
      'groww-stock-orders/fixtures/orders.draft.json',
    );
  });

  it('agrees with the holdings statement once both are in', async () => {
    const state = await importAll([
      [stockFile(), growwStockHoldings],
      [stockOrdersFile(), growwStockOrders],
    ]);
    const holdings = evaluate(state, new PriceBook([], [], all(state, 'snapshot')), '2026-10-20');
    const held = (name: string) => holdings.find((h) => h.instrument.name.startsWith(name))!;

    expect(all(state, 'account')).toHaveLength(1);
    expect(held('RELIANCE').position).toMatchObject({ units: 5, cost: 6_500, estimate: false });
    expect(held('TATA MOTORS').position).toMatchObject({ units: 0, realised: 4_700 });
    // The gold bond has no orders, so the holdings file still gives its units.
    expect(held('2.50%GOLDBONDS').position).toMatchObject({ units: 10, estimate: true });

    const holdingsAgain = await planFile(state, stockFile(), growwStockHoldings);

    expect(upToDate(holdingsAgain)).toBe(true);
    expect(holdingsAgain.items.filter((i) => i.mismatch)).toEqual([]);
  });

  it('falls back to the symbol when a shared file masks the ISIN', async () => {
    const draft = await growwStockOrders.parse(
      sheetFile('Stocks_Order_History.xlsx', [
        HEADER,
        [
          'ONE 97 COMMUNICATIONS LTD',
          'PAYTM',
          'INExxx',
          'BUY',
          6,
          12900,
          'NSE',
          123,
          '16-11-2021 03:30 PM',
          'Executed',
        ],
        [
          'ONE 97 COMMUNICATIONS LTD',
          'PAYTM',
          'INExxx',
          'SELL',
          6,
          11055.3,
          'NSE',
          124,
          '18-11-2021 10:06 AM',
          'Executed',
        ],
        [
          'LIFE INSURA CORP OF INDIA',
          'LICI',
          'INExxx',
          'BUY',
          15,
          13560,
          'NSE',
          125,
          '13-05-2022 03:30 PM',
          'Rejected',
        ],
      ]),
      ctx,
    );

    // With no client code, the orders go to the demat account that holds each stock.
    expect(draft.accounts[0]).toMatchObject({ label: 'Groww demat', byHolding: true });
    expect(draft.instruments).toMatchObject([
      { ref: 'name:one 97 communications ltd', kind: 'stock', ids: { nse: 'PAYTM' } },
    ]);
    expect(draft.transactions.map((t) => [t.date, t.type, t.amount])).toEqual([
      ['2021-11-16', 'buy', 12_900],
      ['2021-11-18', 'sell', 11_055.3],
    ]);
  });

  it('says when no order was executed', async () => {
    const draft = await growwStockOrders.parse(
      sheetFile('orders.xlsx', [
        HEADER,
        [
          'LIFE INSURA CORP OF INDIA',
          'LICI',
          'INE0J1Y01017',
          'BUY',
          15,
          13560,
          'NSE',
          1,
          '13-05-2022 03:30 PM',
          'Cancelled',
        ],
      ]),
      ctx,
    );

    expect(draft.transactions).toEqual([]);
    expect(draft.warnings).toEqual(['The file lists no executed orders']);
  });
});

describe('bob-ppf-statement', () => {
  const HEADER = [
    'TRAN DATE',
    'VALUE DATE',
    'NARRATION',
    'CHQ.NO.',
    'WITHDRAWAL(DR)',
    'DEPOSIT(CR)',
    'BALANCE(INR)',
  ];

  it('reads deposits and interest by value date, oldest first', async () => {
    const draft = await bobPpfStatement.parse(ppfFile(), ctx);

    expect(draft.asOf).toBe('2026-09-15');
    expect(draft.accounts).toEqual([
      {
        ref: 'ppf',
        institution: 'Bank of Baroda',
        kind: 'ppf',
        label: 'Bank of Baroda PPF ••••2345',
        maskedRef: '••••2345',
        currency: 'INR',
      },
    ]);
    expect(draft.instruments).toMatchObject([
      {
        kind: 'ppf',
        name: 'PPF (Bank of Baroda ••••2345)',
        assetClass: 'debt',
        terms: { opened: '2023-05-12' },
      },
    ]);
    // Year-end credits that aren't a multiple of ₹50 are interest; deposits must be.
    expect(draft.transactions.map((t) => [t.date, t.type, t.amount])).toEqual([
      ['2023-05-12', 'contribution', 20_000],
      ['2023-11-03', 'contribution', 5_000],
      ['2024-03-31', 'interest', 1_331],
      ['2024-04-04', 'contribution', 10_050],
      ['2025-03-31', 'contribution', 1_500],
      ['2025-03-31', 'interest', 2_583],
      ['2025-07-20', 'contribution', 500],
      ['2026-03-31', 'interest', 2_897],
      ['2026-06-10', 'contribution', 1_000],
    ]);
    expect(draft.snapshots).toEqual([
      { account: 'ppf', instrument: 'ppf', asOf: '2026-09-15', units: 44_861, value: 44_861 },
    ]);
    expect(draft.warnings).toEqual([]);
    await expect(JSON.stringify(draft, null, 2)).toMatchFileSnapshot(
      'bob-ppf-statement/fixtures/statement.draft.json',
    );
  });

  it('agrees with the PPF rules, so the statement balance checks out', async () => {
    const { state, again } = await importTwice(ppfFile(), bobPpfStatement);
    const [h] = evaluate(state, new PriceBook(), '2026-09-15');

    expect(h!.value).toBeCloseTo(44_861, 6);
    expect(h!.invested).toBe(38_050);
    // Measured to the last credit, the return is close to PPF's 7.1%.
    expect(h).toMatchObject({ xirrTo: '2026-03-31', xirr: expect.closeTo(0.0703, 4) });
    expect(checks(state, new PriceBook(), '2026-09-16', { lastSync: '2026-09-16' })).toEqual([]);
    expect(upToDate(again)).toBe(true);
    expect(again.items.filter((i) => i.mismatch)).toEqual([]);
  });

  it('starts a part-year statement from its opening balance', async () => {
    const draft = await bobPpfStatement.parse(
      sheetFile('OpTransactionHistory01-04-2026.xls', [
        ['Account No:', null, '11110200099999'],
        ['Statement Period from 01/04/2025 to 31/03/2026'],
        [],
        HEADER,
        ['01/04/2025', '01/04/2025', 'PPF DEPOSIT', null, null, '1,50,000.00', '5,50,000.00Cr'],
        ['10/05/2025', '10/05/2025', 'PART WITHDRAWAL', null, '50,000.00', null, '5,00,000.00Cr'],
        ['31/03/2026', '31/03/2026', 'INT.PD 2025-26', null, null, '35,800.00', '5,35,800.00Cr'],
      ]),
      ctx,
    );

    expect(draft.transactions.map((t) => [t.date, t.type, t.amount])).toEqual([
      ['2025-04-01', 'contribution', 150_000],
      ['2025-05-10', 'withdrawal', 50_000],
      ['2026-03-31', 'interest', 35_800],
    ]);
    expect(draft.snapshots).toEqual([
      {
        account: 'ppf',
        instrument: 'ppf',
        asOf: '2025-03-31',
        units: 400_000,
        value: 400_000,
        openingWarnings: [
          'The statement starts with a balance of ₹4,00,000 on 2025-03-31. Import older statements for the full history; until then it counts as one deposit.',
          'Add the date this PPF account was opened to see when it matures',
        ],
      },
      { account: 'ppf', instrument: 'ppf', asOf: '2026-03-31', units: 535_800, value: 535_800 },
    ]);
    expect(draft.instruments[0]!.terms).toBeUndefined();
    expect(draft.warnings).toEqual([]);
  });

  it("warns when the running balance doesn't add up", async () => {
    const draft = await bobPpfStatement.parse(
      sheetFile('ppf.xlsx', [
        ['Account No:', '11110200099999'],
        HEADER,
        ['15/06/2025', '15/06/2025', 'BY CASH', null, '1,000.00', null, '9,000.00Cr'],
        ['10/05/2025', '10/05/2025', 'BY CASH', null, null, '10,000.00', '12,000.00Cr'],
      ]),
      ctx,
    );

    expect(draft.warnings).toContain(
      "The running balance in the file doesn't add up after 2025-05-10. Check the entries against your passbook.",
    );
  });

  it('claims PPF statements, not savings statements in the same layout', async () => {
    expect((await pickImporter(ppfFile(), importers))?.importer.id).toBe('bob-ppf-statement');
    const savings = sheetFile('OpTransactionHistory.xls', [
      HEADER,
      ['02/07/2025', '02/07/2025', 'UPI/SHOP', null, '437.50', null, '9,685.50Cr'],
      ['30/06/2025', '30/06/2025', 'INT.PD', null, null, '123.00', '10,123.00Cr'],
    ]);

    expect(await bobPpfStatement.detect(savings)).toBeLessThan(0.6);
    expect(await bobPpfStatement.detect(mfFile())).toBe(0);
  });
});

describe('epfo-passbook', () => {
  /** A passbook given as the lines read from its PDF. */
  const passbook = (lines: string[]): InputFile => ({
    name: 'passbook.pdf',
    bytes: new Uint8Array(),
    sheets: async () => [],
    pdfText: async () => [{ lines }],
  });
  const HEADER = [
    'Member Passbook',
    '| Establishment ID/Name APHYD0054321000 / BETA SYSTEMS LTD',
    '| Member ID/Name APHYD00543210000011111 / RAVI K',
    'EPF Passbook [ Financial Year - 2026-2027 ]',
  ];

  it('reads contributions, interest and balances from the PDF, split by share', async () => {
    const draft = await epfoPassbook.parse(epfFile(), ctx);

    expect(draft.asOf).toBe('2026-03-31');
    expect(draft.accounts).toEqual([
      {
        ref: 'epf',
        institution: 'Acme Software Private Limited',
        kind: 'epf',
        label: 'Acme Software Private Limited EPF ••••8765',
        maskedRef: '••••8765',
        currency: 'INR',
      },
    ]);
    expect(draft.instruments.map((i) => [i.ref, i.kind, i.name])).toEqual([
      ['epf', 'epf', 'EPF (Acme Software Private Limited ••••8765)'],
      ['eps', 'eps', 'EPS (Acme Software Private Limited ••••8765)'],
    ]);
    // Twelve months of three shares each, then the year's interest on the two EPF shares.
    const rows = draft.transactions.map((t) => [
      t.date,
      t.instrument,
      t.type,
      t.amount,
      t.meta!.part,
    ]);

    expect(rows).toHaveLength(38);
    expect(rows.slice(0, 3)).toEqual([
      ['2025-04-15', 'epf', 'contribution', 3_600, 'employee'],
      ['2025-04-15', 'epf', 'contribution', 2_350, 'employer'],
      ['2025-04-15', 'eps', 'contribution', 1_250, 'pension'],
    ]);
    expect(rows.slice(-2)).toEqual([
      ['2026-03-31', 'epf', 'interest', 11_534, 'employee'],
      ['2026-03-31', 'epf', 'interest', 4_779, 'employer'],
    ]);
    expect(draft.snapshots.map((s) => [s.instrument, s.asOf, s.value])).toEqual([
      ['epf', '2025-03-31', 165_000],
      ['eps', '2025-03-31', 60_000],
      ['epf', '2026-03-31', 252_713],
      ['eps', '2026-03-31', 75_000],
    ]);
    expect(draft.warnings).toEqual([]);
    expect(draft.snapshots[0]!.openingWarnings).toEqual([
      'The passbook starts with a balance of ₹2,25,000 on 2025-03-31. Import older passbooks for the full history; until then it counts as one deposit.',
    ]);
    // The member's name, UAN, date of birth and full member ID stay out.
    expect(JSON.stringify(draft)).not.toMatch(/ASHA|RAO|100000000001|1990|KRBNG/);
    await expect(JSON.stringify(draft, null, 2)).toMatchFileSnapshot(
      'epfo-passbook/fixtures/passbook.draft.json',
    );
  });

  it('agrees with the EPF rules, so the closing balance checks out', async () => {
    const { state, again } = await importTwice(epfFile(), epfoPassbook);
    const holdings = evaluate(state, new PriceBook(), '2026-03-31');
    const held = (kind: string) => holdings.find((h) => h.instrument.kind === kind)!;

    expect(held('epf').balance).toBeCloseTo(252_713, 6);
    // EPS earns no interest, so its value is what went in.
    expect(held('eps').value).toBeCloseTo(75_000, 6);
    expect(checks(state, new PriceBook(), '2026-04-01', { lastSync: '2026-04-01' })).toEqual([]);
    expect(upToDate(again)).toBe(true);
  });

  it('dates a current-year balance by the day the passbook was printed', async () => {
    const draft = await epfoPassbook.parse(
      passbook([
        ...HEADER,
        'OB Int. Updated upto 31/03/2026 2,10,000 90,000 40,000',
        '---No Transactions found for the current year.---',
        'Total Contributions for the year [ 2026 ] 0 0 0',
        'Total Transfer-Ins/Adj for the year [ 2026 ] 0 0 0',
        'Total Withdrawals for the year [ 2026 ] 0 0 0',
        'Interest details N/A 0 0 0',
        'Closing Balance as on 31/03/2027 2,10,000 90,000 40,000',
        'Printed On : 18-10-2026 09:30:00',
      ]),
      ctx,
    );

    expect(draft.accounts[0]!.label).toBe('Beta Systems Ltd EPF ••••1111');
    expect(draft.transactions).toEqual([]);
    expect(draft.asOf).toBe('2026-10-18');
    expect(draft.snapshots.map((s) => [s.instrument, s.asOf, s.value])).toEqual([
      ['epf', '2026-03-31', 300_000],
      ['eps', '2026-03-31', 40_000],
      ['epf', '2026-10-18', 300_000],
      ['eps', '2026-10-18', 40_000],
    ]);
  });

  it('reads withdrawals and rows without a wage month', async () => {
    const draft = await epfoPassbook.parse(
      passbook([
        ...HEADER,
        'OB Int. Updated upto 31/03/2026 2,10,000 90,000 40,000',
        'Apr-2026 15-05-2026 CR Cont. for Due-Month 052026 15,000 15,000 1,800 550 1,250',
        '12-06-2026 DR Claim: Against PARA 68(BB) 0 0 10,000 5,000 0',
        'Total Contributions for the year [ 2026 ] 1,800 550 1,250',
        'Total Transfer-Ins/Adj for the year [ 2026 ] 0 0 0',
        'Total Withdrawals for the year [ 2026 ] 10,000 5,000 0',
        'Interest details N/A 0 0 0',
        'Closing Balance as on 31/03/2027 2,01,800 85,550 41,250',
      ]),
      ctx,
    );

    expect(draft.transactions.map((t) => [t.date, t.type, t.amount, t.meta!.part])).toEqual([
      ['2026-05-15', 'contribution', 1_800, 'employee'],
      ['2026-05-15', 'contribution', 550, 'employer'],
      ['2026-05-15', 'contribution', 1_250, 'pension'],
      ['2026-06-12', 'withdrawal', 10_000, 'employee'],
      ['2026-06-12', 'withdrawal', 5_000, 'employer'],
    ]);
    // Without a print date, the balance is as of the import.
    expect(draft.asOf).toBe('2026-10-22');
    expect(draft.warnings).toEqual([]);
  });

  it('reads a description wrapped above its row, and dates a 1 April opening balance 31 March', async () => {
    const draft = await epfoPassbook.parse(
      passbook([
        ...HEADER,
        'OB Int. Updated upto 01/04/2026 2,10,000 90,000 40,000',
        'Cont. for the Due-Month',
        'Mar-2026 01-04-2026 CR 15,000 15,000 1,800 550 1,250',
        '202604',
        'Cont. for the Due-Month',
        'Apr-2026 01-05-2026 CR 15,000 15,000 1,800 550 1,250',
        '202605',
        'Total Contributions for the year [ 2026 ] 3,600 1,100 2,500',
        'Total Transfer-Ins/VDRs for the year [ 2026 ] 0 0 0',
        'Total Withdrawals for the year [ 2026 ] 0 0 0',
        'Interest details N/A 0 0 0',
        'Closing Balance as on 31/03/2027 2,13,600 91,100 42,500',
        'Printed On : 18-10-2026 09:30:00',
      ]),
      ctx,
    );

    expect(draft.transactions.map((t) => [t.date, t.type, t.amount, t.meta!.part])).toEqual([
      ['2026-04-01', 'contribution', 1_800, 'employee'],
      ['2026-04-01', 'contribution', 550, 'employer'],
      ['2026-04-01', 'contribution', 1_250, 'pension'],
      ['2026-05-01', 'contribution', 1_800, 'employee'],
      ['2026-05-01', 'contribution', 550, 'employer'],
      ['2026-05-01', 'contribution', 1_250, 'pension'],
    ]);
    // The opening balance comes before April's contribution, as the year before closed it.
    expect(draft.snapshots.map((s) => [s.instrument, s.asOf, s.value])).toEqual([
      ['epf', '2026-03-31', 300_000],
      ['eps', '2026-03-31', 40_000],
      ['epf', '2026-10-18', 304_700],
      ['eps', '2026-10-18', 42_500],
    ]);
    expect(draft.warnings).toEqual([]);
  });

  it("warns of the opening balance only until the year before's passbook is in", async () => {
    const year = (fy: number, opening: string, closing: string) =>
      passbook([
        ...HEADER.slice(0, 3),
        `EPF Passbook [ Financial Year - ${fy}-${fy + 1} ]`,
        `OB Int. Updated upto 31/03/${fy} ${opening}`,
        `Apr-${fy} 15-05-${fy} CR Cont. for Due-Month 05${fy} 15,000 15,000 1,800 550 1,250`,
        `Total Contributions for the year [ ${fy} ] 1,800 550 1,250`,
        `Int. Updated upto 31/03/${fy + 1} 0 0 0`,
        `Closing Balance as on 31/03/${fy + 1} ${closing}`,
      ]);
    const first = year(2024, '0 0 0', '1,800 550 1,250');
    const second = year(2025, '1,800 550 1,250', '3,600 1,100 2,500');

    expect((await planFile(replay([]), second, epfoPassbook)).warnings).toEqual([
      'The passbook starts with a balance of ₹3,600 on 2025-03-31. Import older passbooks for the full history; until then it counts as one deposit.',
    ]);
    const after = await planFile(await importAll([[first, epfoPassbook]]), second, epfoPassbook);

    expect(after.warnings).toEqual([]);
    // The year before closed with the same balance this one opens with.
    expect(
      after.items
        .filter((i) => i.put.entity === 'snapshot' && i.put.value.asOf === '2025-03-31')
        .map((i) => i.status),
    ).toEqual(['same', 'same']);
  });

  it("warns when the entries don't add up to the totals or the closing balance", async () => {
    const draft = await epfoPassbook.parse(
      passbook([
        ...HEADER,
        'OB Int. Updated upto 31/03/2026 2,10,000 90,000 40,000',
        'Apr-2026 15-05-2026 CR Cont. for Due-Month 052026 15,000 15,000 1,800 550 1,250',
        'May-2026 15-06-2026 CR Cont. for Due-Month 062026',
        'Total Contributions for the year [ 2026 ] 3,600 1,100 2,500',
        'Closing Balance as on 31/03/2027 2,13,600 91,100 42,500',
      ]),
      ctx,
    );

    expect(draft.warnings.slice(0, 3)).toEqual([
      "The contributions in the passbook don't add up to its totals for the year. Check the entries against your passbook.",
      "The passbook's entries don't add up to its closing balance. Check them against your passbook.",
      "1 entry in the passbook couldn't be read. Check them against your passbook.",
    ]);
  });

  it('claims EPFO passbooks only', async () => {
    expect((await pickImporter(epfFile(), importers))?.importer.id).toBe('epfo-passbook');
    expect(await epfoPassbook.detect(passbook(['Account Statement', 'Opening Balance 0']))).toBe(0);
  });
});

describe('personal data', () => {
  it('never appears in a parsed draft', async () => {
    const paths = fixtures(here);

    expect(paths.length).toBeGreaterThanOrEqual(2);

    for (const path of paths) {
      const file = fixture(path);
      const picked = await pickImporter(file, importers);

      expect(picked, path).not.toBeNull();
      const text = JSON.stringify(await picked!.importer.parse(file, ctx));

      expect(text, path).not.toMatch(/\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/);
      expect(text, path).not.toMatch(/(?<!\d)[6-9]\d{9}(?!\d)/);
      expect(text, path).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text, path).not.toContain('Test Investor');
    }
  });
});

describe('import plan', () => {
  async function plan(state = replay([]), amfi?: ImportContext['amfi']) {
    const file = mfFile();
    const draft = await growwMfHoldings.parse(file, ctx);

    return planImport(state, draft, {
      importer: { id: 'groww-mf-holdings', version: 1 },
      file: { name: file.name, sha256: await sha256Hex(file.bytes), size: file.bytes.length },
      memberId: 'mem_1',
      ...(amfi ? { amfi } : {}),
    });
  }

  it('imports a file once, then says it is up to date', async () => {
    const first = await plan();

    expect(first.totals?.ok).toBe(true);
    expect(
      first.items
        .filter((i) => i.status === 'new')
        .map((i) => i.put.entity)
        .sort(),
    ).toEqual([
      ...Array(6).fill('account'),
      ...Array(5).fill('instrument'),
      ...Array(6).fill('snapshot'),
    ]);
    const data = applyPlan(first, 'bat_1')!;
    const events: Event[] = [
      putEvent(formatHlc(1, 0, 'aaaaaaaa'), 'member', { id: 'mem_1', name: 'Asha' }),
      importApplyEvent(formatHlc(2, 0, 'aaaaaaaa'), data),
    ];
    const state = replay(events);

    expect(
      all(state, 'snapshot').every(
        (s) => s.source.kind === 'import' && s.source.batchId === 'bat_1',
      ),
    ).toBe(true);
    expect(state.batches.get('bat_1')?.findings.map((f) => f.key)).toEqual(
      Array(5).fill('recon.unmatched'),
    );

    const again = await plan(state);

    expect(upToDate(again)).toBe(true);
    expect(applyPlan(again)).toBeNull();

    const s = summary(state, new PriceBook([], [], all(state, 'snapshot')), '2026-10-21');

    expect(s.netWorth).toBeCloseTo(1_094_818.5, 2);
    expect(s.netInvested).toBeCloseTo(1_025_000, 2);
    expect(s.xirrEstimate).toBe(true);
  });

  it("uses the file's own XIRR for a fund until something is recorded after it", async () => {
    const events: Event[] = [
      putEvent(formatHlc(1, 0, 'aaaaaaaa'), 'member', { id: 'mem_1', name: 'Asha' }),
      importApplyEvent(formatHlc(2, 0, 'aaaaaaaa'), applyPlan(await plan(), 'bat_1')!),
    ];
    const state = replay(events);
    const book = new PriceBook([], [], all(state, 'snapshot'));
    const holding = (s: typeof state, name: string, date: string) =>
      evaluate(s, book, date).find((h) => h.instrument.name.startsWith(name))!;

    expect(holding(state, 'Parag', '2026-10-23')).toMatchObject({
      xirr: 0.112,
      xirrEstimate: false,
      xirrAsOf: '2026-10-21',
    });
    // The file says N/A, and the holding is not a year old here either.
    expect(holding(state, 'Tata', '2026-10-23')).toMatchObject({ xirr: null, xirrEstimate: true });

    const parag = holding(state, 'Parag', '2026-10-23');
    const bought = replay([
      ...events,
      putEvent(formatHlc(3, 0, 'aaaaaaaa'), 'transaction', {
        id: 'txn_1',
        accountId: parag.account.id,
        instrumentId: parag.instrument.id,
        date: '2026-10-22',
        type: 'buy',
        units: 10,
        amount: 900,
        currency: 'INR',
        source: { kind: 'manual' },
      }),
    ]);
    const after = holding(bought, 'Parag', '2026-10-23');

    expect(after.xirrAsOf).toBeUndefined();
    expect(after.xirr).toBeNull();
  });

  it('links fund names to AMFI schemes', async () => {
    const p = await plan(replay([]), [
      {
        code: '147481',
        isinGrowth: 'INF879O01100',
        name: 'Parag Parikh ELSS Tax Saver Fund - Direct Plan - Growth',
      },
      { code: '147482', name: 'Parag Parikh ELSS Tax Saver Fund - Regular Plan - Growth' },
      { code: '120505', name: 'Axis Midcap Fund - Direct Plan - Growth' },
      { code: '120504', name: 'Axis Midcap Fund - Direct Plan - IDCW' },
    ]);
    const ppfas = p.matches.find((m) => m.instrument.name.startsWith('Parag'))!;

    expect(ppfas).toMatchObject({
      how: 'amfi',
      confirm: true,
      instrument: { ids: { amfi: '147481', isin: 'INF879O01100' } },
    });
    expect(p.matches.find((m) => m.instrument.name.startsWith('Axis'))?.instrument.ids.amfi).toBe(
      '120505',
    );
    expect(p.findings.filter((f) => f.key === 'recon.unmatched')).toHaveLength(3);
  });

  it('flags a stale price once for a fund held in two folios', async () => {
    const state = await importAll([[mfFile(), growwMfHoldings]]);
    const keys = checks(state, new PriceBook([], [], all(state, 'snapshot')), '2026-11-15', {
      lastSync: '2026-11-15',
    }).map((c) => c.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k.startsWith('price.stale'))).toHaveLength(5);
  });

  it('flags file totals that do not match the lines', async () => {
    const file = mfFile();
    const draft = await growwMfHoldings.parse(file, ctx);

    draft.totals = { invested: 1_000_000, value: 1_094_818.5 };
    const p = planImport(replay([]), draft, {
      importer: { id: 'groww-mf-holdings', version: 1 },
      file: { name: 'holdings.xlsx', sha256: 'x', size: 1 },
      memberId: 'mem_1',
    });

    expect(p.totals?.ok).toBe(false);
    expect(p.findings.some((f) => f.key === 'recon.total')).toBe(true);
  });
});
