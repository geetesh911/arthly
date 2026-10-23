// SPDX-License-Identifier: AGPL-3.0-only
// The Excel export: tabs for reading, plus data tabs in the template format for re-importing.
// Values only, no live formulas.
import type { Workbook, Worksheet } from 'exceljs';
import { income } from '../../../engine/income.ts';
import { engineCache, history, summary } from '../../../engine/portfolio.ts';
import { isBalanceKind } from '../../../engine/positions.ts';
import { upcoming } from '../../../engine/upcoming.ts';
import { all, get } from '../../../log/replay.ts';
import { fyLabel, fyOf, type ISODate } from '../../../util/dates.ts';
import { DATA_ENTITIES, DATA_TABS, toRow } from '../columns.ts';
import type { Exporter, ExportInput } from '../types.ts';

const INR = '[>=10000000]₹##\\,##\\,##\\,##0;[>=100000]₹##\\,##\\,##0;₹##,##0';
const PCT = '0.00%';
const UNITS = '#,##0.000';

async function excel(): Promise<typeof import('exceljs')> {
  const mod = (await import('exceljs')) as unknown as {
    default?: typeof import('exceljs');
  } & typeof import('exceljs');
  return mod.default ?? mod;
}

function sheet(
  book: Workbook,
  name: string,
  columns: { header: string; width?: number; format?: string }[],
): Worksheet {
  const ws = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header,
    width: c.width ?? 14,
    style: c.format ? { numFmt: c.format } : {},
  }));
  ws.getRow(1).font = { bold: true };
  return ws;
}

const date = (iso: ISODate | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

export async function buildWorkbook(
  input: ExportInput,
  options: { readingTabs: boolean } = { readingTabs: true },
): Promise<Workbook> {
  const { Workbook } = await excel();
  const book = new Workbook();
  book.creator = 'Arthly';
  const { state, book: prices } = input;
  const opts = { ...(input.rates ? { rates: input.rates } : {}), cache: engineCache(state) };
  const memberName = (id: string) => get(state, 'member', id)?.name ?? id;
  const accountLabel = (id: string) => get(state, 'account', id)?.label ?? id;
  const instrumentName = (id: string) => get(state, 'instrument', id)?.name ?? id;

  if (options.readingTabs) {
    const s = summary(state, prices, input.date, input.filter, opts);
    const top = sheet(book, 'Summary', [
      { header: 'Figure', width: 22 },
      { header: 'Value', width: 18 },
    ]);
    top.addRows([
      ['As of', date(input.date)],
      ['Filter', input.filter ? JSON.stringify(input.filter) : 'Everything'],
      ['Net worth', s.netWorth],
      ['Net invested', s.netInvested],
      ['Total gain', s.totalGain],
      [s.xirrEstimate ? 'XIRR (≈ estimate)' : 'XIRR', s.xirr],
      [],
      ['Asset class', 'Value'],
      ...Object.entries(s.allocation.assetClass).map(([k, v]) => [k, v]),
    ]);
    top.getCell('B1').numFmt = 'dd-mmm-yyyy';
    for (const r of [3, 4, 5]) top.getCell(`B${r}`).numFmt = INR;
    top.getCell('B6').numFmt = PCT;
    top.getRow(8).font = { bold: true };
    for (let r = 9; r <= top.rowCount; r++) top.getCell(`B${r}`).numFmt = INR;

    const groups = all(state, 'group');
    const holdings = sheet(book, 'Holdings', [
      { header: 'Member', width: 14 },
      { header: 'Account', width: 30 },
      { header: 'Group', width: 16 },
      { header: 'Instrument', width: 44 },
      { header: 'Class', width: 10 },
      { header: 'Units', format: UNITS },
      { header: 'Price', format: '#,##0.0000' },
      { header: 'Price date', format: 'dd-mmm-yyyy' },
      { header: 'Invested', format: INR },
      { header: 'Value', format: INR },
      { header: 'Gain', format: INR },
      { header: 'Gain %', format: PCT },
      { header: 'XIRR', format: PCT },
      { header: 'Weight', format: PCT },
    ]);
    for (const h of s.holdings) {
      const units =
        isBalanceKind(h.instrument.kind) || h.instrument.kind === 'cash' ? null : h.position.units;
      holdings.addRow([
        memberName(h.memberId),
        h.account.label,
        h.groupIds.map((g) => groups.find((x) => x.id === g)?.name ?? g).join(', '),
        h.instrument.name,
        h.instrument.assetClass,
        units,
        units ? h.value / units : null,
        date(h.priceDate),
        h.invested,
        h.value,
        h.gain,
        h.gainPct,
        h.xirr,
        h.weight,
      ]);
    }

    const txns = sheet(book, 'Transactions', [
      { header: 'Date', format: 'dd-mmm-yyyy' },
      { header: 'Member' },
      { header: 'Account', width: 30 },
      { header: 'Instrument', width: 44 },
      { header: 'Type' },
      { header: 'Units', format: UNITS },
      { header: 'Price', format: '#,##0.0000' },
      { header: 'Amount', format: '#,##0.00' },
      { header: 'Currency', width: 9 },
      { header: 'Source', width: 10 },
    ]);
    const list = all(state, 'transaction').sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    for (const t of list) {
      const memberId = get(state, 'account', t.accountId)?.memberId ?? '';
      if (input.filter?.memberId && input.filter.memberId !== memberId) continue;
      txns.addRow([
        date(t.date),
        memberName(memberId),
        accountLabel(t.accountId),
        instrumentName(t.instrumentId),
        t.type,
        t.units ?? null,
        t.price ?? null,
        t.amount,
        t.currency,
        t.source.kind,
      ]);
    }

    const inc = sheet(book, 'Income', [
      { header: 'Financial year' },
      { header: 'Member' },
      { header: 'Instrument', width: 44 },
      { header: 'Type' },
      { header: 'Received', format: INR },
      { header: 'Accrued', format: INR },
      { header: 'Note', width: 40 },
    ]);
    const first = s.firstFlow ?? input.date;
    for (let fy = fyOf(first); fy <= fyOf(input.date); fy++) {
      for (const r of income(state, prices, fy, opts)) {
        if (input.filter?.memberId && input.filter.memberId !== r.memberId) continue;
        const notes = [
          r.taxFree ? 'Tax-free' : '',
          r.estimated ? 'Includes estimates' : '',
          r.tds ? `TDS ₹${r.tds}` : '',
        ]
          .filter(Boolean)
          .join('; ');
        inc.addRow([
          fyLabel(fy),
          memberName(r.memberId),
          instrumentName(r.instrumentId),
          r.type,
          r.received,
          r.accrued,
          notes,
        ]);
      }
    }
    inc.addRow([]);
    inc.addRow(['A summary, not tax advice.']);

    const soon = sheet(book, 'Coming up', [
      { header: 'Date', format: 'dd-mmm-yyyy' },
      { header: 'Event', width: 14 },
      { header: 'Instrument', width: 44 },
      { header: 'Amount', format: INR },
    ]);
    for (const u of upcoming(state, prices, input.date, 365, opts)) {
      soon.addRow([date(u.date), u.kind, instrumentName(u.instrumentId), u.amount ?? null]);
    }

    const classes = Object.keys(s.allocation.assetClass);
    const hist = sheet(book, 'Monthly history', [
      { header: 'Month end', format: 'dd-mmm-yyyy' },
      { header: 'Net worth', format: INR },
      { header: 'Net invested', format: INR },
      { header: 'Gain', format: INR },
      ...classes.map((c) => ({ header: c, format: INR })),
    ]);
    if (s.firstFlow) {
      const points = history(state, prices, s.firstFlow, input.date, {
        ...opts,
        step: 'month',
        ...(input.filter ? { filter: input.filter } : {}),
      });
      for (const p of points) {
        hist.addRow([
          date(p.date),
          p.value,
          p.netInvested,
          p.value - p.netInvested,
          ...classes.map((c) => p.assetClass[c as keyof typeof p.assetClass] ?? 0),
        ]);
      }
    }
  }

  for (const entity of DATA_ENTITIES) {
    const { tab, columns } = DATA_TABS[entity]!;
    const ws = book.addWorksheet(tab);
    ws.addRow(columns.map((c) => c.key));
    ws.getRow(1).font = { bold: true };
    for (const value of all(state, entity)) ws.addRow(toRow(entity, value));
  }
  return book;
}

export const excelExporter: Exporter = {
  id: 'excel',
  label: 'Excel (.xlsx)',
  extension: '.xlsx',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  encrypted: false,
  async run(input) {
    const book = await buildWorkbook(input);
    return new Uint8Array(await book.xlsx.writeBuffer());
  },
};

/** An empty workbook with only the data tabs and their headings, for filling in by hand. */
export const templateExporter: Exporter = {
  id: 'template',
  label: 'Blank template (.xlsx)',
  extension: '.xlsx',
  mime: excelExporter.mime,
  encrypted: false,
  async run(input) {
    const book = await buildWorkbook(
      {
        ...input,
        state: {
          ...input.state,
          tables: Object.fromEntries(
            Object.keys(input.state.tables).map((k) => [k, new Map()]),
          ) as typeof input.state.tables,
        },
      },
      { readingTabs: false },
    );
    const readme = book.addWorksheet('Read me');
    readme.addRows([
      ['Fill in one row per record on the tabs that start with _.'],
      ['Leave id blank for new records. Dates are YYYY-MM-DD.'],
      [
        'Amounts are positive; the type (buy, sell, contribution, withdrawal…) gives the direction.',
      ],
      ['Rows missing from a file never delete anything.'],
    ]);
    return new Uint8Array(await book.xlsx.writeBuffer());
  },
};
