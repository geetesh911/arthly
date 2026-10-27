// SPDX-License-Identifier: AGPL-3.0-only
import { type LocalStore, MemoryLocalStore } from '@pv/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DataService, LockedError } from './service.ts';
import type { DeviceStorage, VaultEntry } from './storage.ts';

function memoryStorage(): DeviceStorage {
  const entries = new Map<string, VaultEntry>();
  const stores = new Map<string, LocalStore>();

  return {
    async vaults() {
      return [...entries.values()];
    },
    async addVault(e) {
      entries.set(e.vaultId, e);
    },
    async removeVault(id) {
      entries.delete(id);
      stores.delete(id);
    },
    async open(id) {
      if (!stores.has(id)) {
        stores.set(id, new MemoryLocalStore());
      }

      return stores.get(id)!;
    },
  };
}

const fixtures = join(import.meta.dirname, '../../../../../packages/core/src/plugins/importers');
const mf = new Uint8Array(readFileSync(join(fixtures, 'groww-mf-holdings/fixtures/holdings.xlsx')));
const stocks = new Uint8Array(
  readFileSync(join(fixtures, 'groww-stock-holdings/fixtures/holdings.xlsx')),
);
const offline = (async () => new Response('offline', { status: 503 })) as typeof fetch;

const prices = join(import.meta.dirname, '../../../../../packages/core/src/plugins/prices/feed');

/** The relay and Frankfurter, answering from saved files; `stocks` says whether NSE is up. */
function relay(state = { stocks: true }) {
  const file = (name: string, source: string) => () =>
    new Response(readFileSync(join(prices, 'fixtures', name)), {
      headers: { 'x-relay-source': source },
    });
  const table: Record<string, () => Response> = {
    'https://app.test/api/prices/amfi': file('NAVAll.txt', 'amfi'),
    'https://app.test/api/prices/exchange': () =>
      state.stocks
        ? file('nse-bhavcopy.csv.zip', 'nse')()
        : new Response("NSE and BSE didn't send a closing-price file", { status: 502 }),
    'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR': () =>
      Response.json({ date: '2026-10-21', rates: { INR: 88.12 } }),
  };

  return (async (input: RequestInfo | URL) =>
    table[String(input)]?.() ?? new Response('Not found', { status: 404 })) as typeof fetch;
}

/** The relay's answer for AMFI's cap list: an excerpt of the June 2026 workbook. */
const capList = () =>
  new Response(
    readFileSync(join(prices, '../caps/fixtures/AverageMarketCapitalization30Jun2026.xlsx')),
    {
      headers: {
        'x-relay-source': 'amfi-caps',
        'x-source-url':
          'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx',
      },
    },
  );

function service(
  storage = memoryStorage(),
  fetch = offline,
  now = () => new Date('2026-10-22T10:00:00+05:30'),
) {
  return new DataService(storage, {
    fetch,
    relayUrl: 'https://app.test/api/prices/',
    now,
    kdf: { alg: 'argon2id', m: 256, t: 1, p: 1 },
  });
}

describe('data service', () => {
  it('creates a vault, imports Groww files and adds up the dashboard', async () => {
    const s = service();
    const { vaultId, recoveryCode } = await s.create('Family', 'Asha', 'correct horse');

    expect(recoveryCode).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    const [member] = s.list('member');

    for (const [name, bytes] of [
      ['mf.xlsx', mf],
      ['stocks.xlsx', stocks],
    ] as const) {
      const prepared = await s.prepareImport(name, bytes, member!.id);

      if (prepared.kind !== 'plan') {
        throw new Error('not recognised');
      }

      expect(prepared.plan.totals?.ok).toBe(true);
      expect((await s.confirmImport(prepared.plan.planId)).written).toBeGreaterThan(0);
    }

    const overview = await s.overview();

    expect(overview.netWorth).toBeCloseTo(1_094_818.5 + 196_620, 1);
    expect(overview.holdings).toBe(12);
    expect(s.batches()).toHaveLength(2);

    const again = await s.prepareImport('mf.xlsx', mf, member!.id);

    expect(again.kind === 'plan' && again.plan.upToDate).toBe(true);

    s.lock();
    await expect(s.overview()).rejects.toThrow(LockedError);
    await expect(s.unlock(vaultId, { passphrase: 'wrong' })).rejects.toThrow('Wrong passphrase');
    await s.unlock(vaultId, { recoveryCode });
    expect((await s.overview()).holdings).toBe(12);
  });

  it('refreshes prices through the relay, keeping old ones for a part that fails', async () => {
    const nse = { stocks: true };
    const s = service(memoryStorage(), relay(nse));

    await s.create('Family', 'Asha', 'pw');
    const prepared = await s.prepareImport('stocks.xlsx', stocks, s.list('member')[0]!.id);

    if (prepared.kind !== 'plan') {
      throw new Error('not recognised');
    }

    await s.confirmImport(prepared.plan.planId);
    const sgb = () => s.holdings().find((h) => h.name === '2.50%GOLDBONDS2032SR-IV')!;

    expect(await s.refreshPrices(true)).toEqual({ ok: true });
    expect(sgb()).toMatchObject({ price: 15155.6, priceDate: '2026-10-21' });
    expect(s.priceStatus()).toMatchObject({ stocks: '2026-10-21', funds: undefined });

    nse.stocks = false;
    const result = await s.refreshPrices(true);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "Couldn't update stock prices (NSE and BSE didn't send a closing-price file). Using the prices saved earlier.",
    );
    expect(sgb()).toMatchObject({ price: 15155.6, priceDate: '2026-10-21' });
  });

  it('says so when there is no relay and no feed', async () => {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const result = await s.refreshPrices(true);

    expect(result).toEqual({
      ok: false,
      message:
        "Couldn't fetch prices (offline; Frankfurter: 503). Holdings are valued from their files until it can.",
    });
  });

  it('undoes an import', async () => {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const prepared = await s.prepareImport('stocks.xlsx', stocks, s.list('member')[0]!.id);

    if (prepared.kind !== 'plan') {
      throw new Error('not recognised');
    }

    const { batchId } = await s.confirmImport(prepared.plan.planId);

    expect(s.holdings()).toHaveLength(6);
    await s.revertImport(batchId!);
    expect(s.holdings()).toHaveLength(0);
    expect(s.batches()[0]).toMatchObject({ reverted: true });
  });

  it('renames members, and removes one only once it has no accounts', async () => {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const asha = s.list('member')[0]!.id;

    await s.save('member', { id: 'mem_ravi', name: 'Ravi' });
    await s.rename('member', 'mem_ravi', '  Ravi K ');
    expect(s.list('member').map((m) => m.name)).toContain('Ravi K');
    await expect(s.rename('member', asha, ' ')).rejects.toThrow('Type a name');

    const prepared = await s.prepareImport('stocks.xlsx', stocks, asha);

    if (prepared.kind !== 'plan') {
      throw new Error('not recognised');
    }

    await s.confirmImport(prepared.plan.planId);
    await expect(s.removeMember(asha)).rejects.toThrow('Remove Asha’s accounts first');
    await s.removeMember('mem_ravi');
    expect(s.list('member').map((m) => m.name)).toEqual(['Asha']);

    await s.removeAccount(s.accounts()[0]!.id);
    await expect(s.removeMember(asha)).rejects.toThrow('at least one member');
  });

  it('removes an account with its records, and takes it out of groups', async () => {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const prepared = await s.prepareImport('stocks.xlsx', stocks, s.list('member')[0]!.id);

    if (prepared.kind !== 'plan') {
      throw new Error('not recognised');
    }

    await s.confirmImport(prepared.plan.planId);
    const [account] = s.accounts();

    expect(account).toMatchObject({ member: 'Asha', transactions: 0, balances: 6 });
    await s.rename('account', account!.id, 'Stocks');
    expect(s.accounts()[0]!.label).toBe('Stocks');

    const [first, second] = s.holdings();

    await s.save('group', {
      id: 'grp_1',
      name: 'Core',
      holdings: [
        { accountId: account!.id, instrumentId: first!.instrumentId },
        { instrumentId: second!.instrumentId },
      ],
    });
    await s.removeAccount(account!.id);
    expect(s.accounts()).toEqual([]);
    expect(s.holdings()).toHaveLength(0);
    expect(s.list('group')[0]!.holdings).toEqual([{ instrumentId: second!.instrumentId }]);

    // The same file brings it all back.
    const again = await s.prepareImport('stocks.xlsx', stocks, s.list('member')[0]!.id);

    expect(again.kind === 'plan' && again.plan.upToDate).toBe(false);
  });

  it('tells what an unknown file holds, without its values', async () => {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const csv = 'Name,Asha\nDate,Narration,Amount\n2026-01-01,Salary,100000';
    const result = await s.prepareImport('notes.csv', new TextEncoder().encode(csv), 'x');

    expect(result).toEqual({ kind: 'unknown', headings: ['Date', 'Narration', 'Amount'] });
  });

  it('exports to Excel and restores the same holdings on another vault', async () => {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const memberId = s.list('member')[0]!.id;
    const prepared = await s.prepareImport('mf.xlsx', mf, memberId);

    if (prepared.kind !== 'plan') {
      throw new Error('not recognised');
    }

    await s.confirmImport(prepared.plan.planId);
    const file = await s.exportFile('excel');

    expect(file.name).toBe('arthly-2026-10-22.xlsx');

    const other = service();

    await other.create('Copy', 'Asha', 'pw');
    const back = await other.prepareImport(file.name, file.bytes, memberId);

    if (back.kind !== 'plan') {
      throw new Error('not recognised');
    }

    await other.confirmImport(back.plan.planId);
    expect((await other.overview()).netWorth).toBeCloseTo((await s.overview()).netWorth, 2);
  });

  it('restores a backup file on a new device', async () => {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const prepared = await s.prepareImport('stocks.xlsx', stocks, s.list('member')[0]!.id);

    if (prepared.kind !== 'plan') {
      throw new Error('not recognised');
    }

    await s.confirmImport(prepared.plan.planId);
    const backup = await s.backup();

    const phone = service();

    await expect(phone.restore(backup.bytes, { passphrase: 'nope' })).rejects.toThrow();
    await phone.restore(backup.bytes, { passphrase: 'pw' });
    expect(phone.holdings()).toHaveLength(6);
    await expect(phone.restore(backup.bytes, { passphrase: 'pw' })).rejects.toThrow(
      'already on this device',
    );
  });

  it('opens sample data without touching storage', async () => {
    const storage = memoryStorage();
    const s = service(storage);

    await s.demo();
    expect(s.current()).toMatchObject({ demo: true });
    expect(s.holdings().length).toBeGreaterThan(3);
    expect(await storage.vaults()).toEqual([]);
  });

  it('scopes analytics and the plan to the selected member', async () => {
    const s = service();

    await s.demo();
    const everyone = s.analytics();
    const asha = s.analytics({ memberId: 'mem_demo1' });
    const ravi = s.analytics({ memberId: 'mem_demo2' });

    expect(asha.total + ravi.total).toBeCloseTo(everyone.total, 2);
    expect(s.plan().total).toBeCloseTo(everyone.total, 2);
    expect(s.plan({ memberId: 'mem_demo1' }).assetValues.debt).toBeUndefined();
  });

  it('splits hybrid funds into the classes they hold in the plan', async () => {
    const s = service();

    await s.demo();
    const before = s.plan().assetValues;

    await s.save('instrument', {
      id: 'ins_baf',
      kind: 'mf',
      name: 'Example Balanced Advantage Fund Direct Growth',
      currency: 'INR',
      assetClass: 'hybrid',
      ids: {},
    });
    await s.save('snapshot', {
      id: 'snp_baf',
      accountId: 'acc_demo_mf',
      instrumentId: 'ins_baf',
      asOf: '2026-10-22',
      units: 1,
      value: 100_000,
      invested: 100_000,
      source: { kind: 'manual' },
    });
    const p = s.plan();

    // No fund reports are loaded, so it's split as a typical balanced advantage fund.
    expect(p.hybrid).toMatchObject([
      { id: 'ins_baf', method: 'type', type: 'Balanced advantage', value: 100_000 },
    ]);
    expect(p.assetValues.hybrid).toBeUndefined();
    expect(p.assetValues.equity).toBeCloseTo((before.equity ?? 0) + 50_000, 2);
    expect(p.assetValues.debt).toBeCloseTo((before.debt ?? 0) + 50_000, 2);
  });

  it('saves the allocation plan and emergency fund for each selection', async () => {
    const s = service();

    await s.demo();
    expect(s.plan()).toMatchObject({ targets: null, allocation: null, emergencyFund: null });
    await s.saveAllocationPlan(
      { targets: { equity: 70, cash: 30 }, mode: 'new-money', band: 5, amount: 25_000 },
      'mem_demo1',
    );
    await s.saveEmergencyFund({ monthlyExpenses: 50_000, months: 6 }, 'mem_demo1');
    expect(s.plan({ memberId: 'mem_demo1' })).toMatchObject({
      targets: { equity: 70, cash: 30 },
      allocation: { mode: 'new-money', band: 5, amount: 25_000 },
      emergencyFund: { monthlyExpenses: 50_000, months: 6 },
    });
    expect(s.plan()).toMatchObject({ targets: null, allocation: null, emergencyFund: null });
    // The demo's FD is its only emergency money; its funds are equity and gold.
    expect(s.plan().emergency).toMatchObject({ cash: 0, cashFunds: 0 });
    expect(s.plan().emergency.deposits).toBeGreaterThan(0);

    const plan = { mode: 'new-money', band: 5, amount: 0 } as const;

    await expect(
      s.saveAllocationPlan({ ...plan, targets: { equity: 110, cash: -10 } }),
    ).rejects.toThrow('100%');
    await expect(
      s.saveAllocationPlan({ ...plan, band: 60, targets: { equity: 100 } }),
    ).rejects.toThrow('drift band');
    await expect(s.saveEmergencyFund({ monthlyExpenses: 0, months: 6 })).rejects.toThrow(
      'monthly expenses',
    );
  });

  it('retains NSE classifications and AMFI’s cap list across failed refreshes and reloads', async () => {
    const storage = memoryStorage();
    let available = true;
    const fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/nse-reference')) {
        return available
          ? Response.json(
              {
                date: '2026-10-21',
                rows: [
                  {
                    symbol: 'RELIANCE',
                    isin: 'INE002A01018',
                    industry: 'Oil Gas & Consumable Fuels',
                    marketCap: 'large',
                  },
                ],
                stale: [],
              },
              { headers: { 'x-relay-source': 'nse-reference' } },
            )
          : new Response('offline', { status: 503 });
      }

      if (String(input).endsWith('/amfi-caps')) {
        return available ? capList() : new Response('AMFI didn’t answer', { status: 502 });
      }

      return relay()(input);
    }) as typeof globalThis.fetch;
    const s = service(storage, fetch);

    await s.create('Family', 'Asha', 'pw');
    const vaultId = s.current()!.vaultId;
    const memberId = s.list('member')[0]!.id;

    await s.save('account', {
      id: 'a',
      memberId,
      label: 'a',
      institution: 'Test',
      kind: 'demat',
      currency: 'INR',
    });
    await s.save('instrument', {
      id: 'i',
      kind: 'stock',
      name: 'One',
      currency: 'INR',
      assetClass: 'equity',
      ids: { isin: 'INE002A01018' },
    });
    await s.save('snapshot', {
      id: 's',
      accountId: 'a',
      instrumentId: 'i',
      asOf: '2026-10-22',
      units: 1,
      value: 100,
      invested: 100,
      source: { kind: 'manual' },
    });
    await s.refreshPrices(true);
    // Reliance takes its closing price from the exchange file, so its value isn't 100 any more.
    const { sectors, marketCap } = s.analytics();

    expect(sectors.total).toBeGreaterThan(0);
    expect(sectors.classified).toBe(sectors.total);
    expect(marketCap.classified).toBe(marketCap.total);
    expect(s.analytics().reference.caps).toMatchObject({ asOf: '2026-06-30', companies: 9 });
    available = false;
    await s.refreshPrices(true);
    expect(s.analytics().reference.nseDate).toBe('2026-10-21');
    expect(s.analytics().reference.nseStale).toBe(true);
    expect(s.analytics().reference.capsFailure).toBe('AMFI didn’t answer');
    s.lock();
    await s.unlock(vaultId, { passphrase: 'pw' });
    expect(s.analytics().marketCap.slices[0]?.label).toBe('Large cap');
    expect(s.analytics().reference.caps?.asOf).toBe('2026-06-30');
  });

  it('fetches AMFI’s cap list weekly, and only when stocks or funds are held', async () => {
    let now = new Date('2026-10-22T10:00:00+05:30');
    let asked = 0;
    const fetch = (async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/amfi-caps')) {
        return relay()(input);
      }

      asked++;

      return capList();
    }) as typeof globalThis.fetch;
    const s = service(memoryStorage(), fetch, () => now);

    await s.create('Family', 'Asha', 'pw');
    await s.refreshPrices(true);
    expect(asked).toBe(0);
    const memberId = s.list('member')[0]!.id;

    await s.save('account', {
      id: 'a',
      memberId,
      label: 'a',
      institution: 'Test',
      kind: 'demat',
      currency: 'INR',
    });
    await s.save('instrument', {
      id: 'i',
      kind: 'stock',
      name: 'Reliance',
      currency: 'INR',
      assetClass: 'equity',
      ids: { isin: 'INE002A01018' },
    });
    await s.refreshPrices(true);
    expect(asked).toBe(1);
    now = new Date('2026-10-26T10:00:00+05:30');
    await s.refreshPrices();
    expect(asked).toBe(1);
    now = new Date('2026-10-30T10:00:00+05:30');
    await s.refreshPrices();
    expect(asked).toBe(2);
  });

  it('locks itself after the idle time', async () => {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    let locked = false;

    s.onLock = () => (locked = true);
    await s.setAutoLock(1);
    expect(await s.autoLockMinutes()).toBe(1);
    s.lock();
    expect(locked).toBe(true);
    expect(s.isUnlocked()).toBe(false);
  });

  it('fetches every index level with each refresh and keeps them across a failure and unlock', async () => {
    const storage = memoryStorage();
    let up = true;
    let now = new Date('2026-10-22T20:00:00+05:30');
    const day = (date: string, close: number) => ({
      version: 1,
      date,
      sources: [{ provider: 'nse', url: `https://nsearchives.nseindia.com/${date}.csv`, date }],
      series: [
        {
          id: 'nse:nifty-50',
          provider: 'nse',
          name: 'Nifty 50',
          basis: 'price',
          currency: 'INR',
          date,
          close,
        },
      ],
      history: {},
    });
    let data = day('2026-10-22', 22687.65);
    const fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/index-data')) {
        return up
          ? Response.json(data, { headers: { 'x-relay-source': 'index-data' } })
          : new Response('offline', { status: 503 });
      }

      return relay()(input);
    }) as typeof globalThis.fetch;
    const s = service(storage, fetch, () => now);

    await s.create('Family', 'Asha', 'pw');
    const vaultId = s.current()!.vaultId;

    expect(s.analytics().indices.rows).toEqual([]);
    // Nothing is held, and the levels still come.
    await s.refreshPrices(true);
    expect(s.analytics().indices.rows[0]).toMatchObject({ close: 22687.65, since: '2026-10-22' });
    now = new Date('2026-10-23T20:00:00+05:30');
    data = day('2026-10-23', 22700);
    await s.refreshPrices();
    up = false;
    now = new Date('2026-10-24T20:00:00+05:30');
    await s.refreshPrices(true);
    s.lock();
    await s.unlock(vaultId, { passphrase: 'pw' });
    const indices = s.analytics().indices;

    expect(indices.rows[0]).toMatchObject({
      date: '2026-10-23',
      close: 22700,
      since: '2026-10-22',
    });
    expect(indices.sources[0]).toMatchObject({ date: '2026-10-23', failure: 'offline' });
  });

  it('falls back to the relay for index levels when the feed has none', async () => {
    const asked: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));

      if (String(input).endsWith('/index-data')) {
        return Response.json(
          {
            version: 1,
            date: '2026-10-22',
            sources: [
              { provider: 'bse', url: 'https://www.bseindia.com/x.csv', date: '2026-10-22' },
            ],
            series: [],
            history: {},
          },
          { headers: { 'x-relay-source': 'index-data' } },
        );
      }

      return new Response('Not found', { status: 404 });
    }) as typeof globalThis.fetch;
    const s = new DataService(memoryStorage(), {
      fetch,
      relayUrl: 'https://app.test/api/prices/',
      feedUrl: 'https://feed.test/',
      now: () => new Date('2026-10-22T20:00:00+05:30'),
      kdf: { alg: 'argon2id', m: 256, t: 1, p: 1 },
    });

    await s.create('Family', 'Asha', 'pw');
    await s.refreshPrices(true);
    expect(asked).toContain('https://feed.test/v1/latest/indices.json.gz');
    expect(s.analytics().indices.sources[0]).toMatchObject({ provider: 'bse', date: '2026-10-22' });
  });

  it('loads fund stocks through the relay and retains dated disclosures across failure and unlock', async () => {
    const storage = memoryStorage();
    let available = true;
    let now = new Date('2026-10-22T10:00:00+05:30');
    let disclosureCalls = 0;
    const workbookUrl =
      'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls';
    const workbook = readFileSync(join(prices, '../fund-holdings/fixtures/ppfas.xls'));
    const fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/fund-disclosures')) {
        disclosureCalls++;

        return available
          ? Response.json(
              {
                version: 1,
                date: '2026-10-22',
                files: [{ source: 'ppfas', url: workbookUrl, name: 'ppfas.xls' }],
                failures: [],
              },
              { headers: { 'x-relay-source': 'fund-disclosures' } },
            )
          : new Response('offline', { status: 503 });
      }

      if (url.includes('/fund-workbook?')) {
        return new Response(workbook, { headers: { 'x-relay-source': 'fund-workbook' } });
      }

      return relay()(input);
    }) as typeof globalThis.fetch;
    const s = service(storage, fetch, () => now);

    await s.create('Family', 'Asha', 'pw');
    const vaultId = s.current()!.vaultId;
    const memberId = s.list('member')[0]!.id;

    await s.save('account', {
      id: 'a',
      memberId,
      label: 'Funds',
      institution: 'AMC',
      kind: 'mf',
      currency: 'INR',
    });
    await s.save('instrument', {
      id: 'f',
      kind: 'mf',
      name: 'Parag Parikh ELSS Tax Saver Fund Direct Growth',
      currency: 'INR',
      assetClass: 'equity',
      ids: { amfi: '147481' },
    });
    await s.save('snapshot', {
      id: 'snap',
      accountId: 'a',
      instrumentId: 'f',
      asOf: '2026-10-22',
      units: 1,
      value: 100,
      invested: 80,
      source: { kind: 'manual' },
    });
    await s.refreshPrices(true);
    const a = s.analytics();

    expect(a.lookthrough.coverage.covered).toBeGreaterThan(0);
    expect(a.lookthrough.funds[0]?.asOf).toBe('2026-09-30');
    expect(a.stocks.rows.find((r) => r.key === 'isin:INE040A01034')?.indirectValue).toBeCloseTo(
      s.holdings()[0]!.value * 0.0757,
      4,
    );

    // Six-hour price refreshes must not postpone the daily disclosure refresh.
    for (let hour = 6; hour <= 24; hour += 6) {
      now = new Date(new Date('2026-10-22T10:00:00+05:30').getTime() + hour * 3600_000);
      await s.refreshPrices();
    }

    expect(disclosureCalls).toBe(2);
    expect(s.analytics().lookthrough.funds[0]?.retained).toBe(false);
    available = false;
    await s.refreshPrices(true);
    expect(s.analytics().reference.fundFailures[0]?.label).toBe('Fund reports');
    s.lock();
    await s.unlock(vaultId, { passphrase: 'pw' });
    expect(s.analytics().lookthrough.funds[0]?.asOf).toBe('2026-09-30');
    expect(s.analytics().lookthrough.funds[0]?.retained).toBe(true);
    expect(s.analytics({ memberId: 'nobody' }).lookthrough.funds).toEqual([]);
  });

  it('uses fund reports added by hand through refreshes and unlock, until they are removed', async () => {
    const storage = memoryStorage();
    const s = service(storage);

    await s.create('Family', 'Asha', 'pw');
    const vaultId = s.current()!.vaultId;
    const memberId = s.list('member')[0]!.id;

    await s.save('account', {
      id: 'a',
      memberId,
      label: 'Funds',
      institution: 'AMC',
      kind: 'mf',
      currency: 'INR',
    });
    await s.save('instrument', {
      id: 'f',
      kind: 'mf',
      name: 'Parag Parikh ELSS Tax Saver Fund Direct Growth',
      currency: 'INR',
      assetClass: 'equity',
      ids: {},
    });
    await s.save('snapshot', {
      id: 'snap',
      accountId: 'a',
      instrumentId: 'f',
      asOf: '2026-10-22',
      units: 1,
      value: 100,
      invested: 80,
      source: { kind: 'manual' },
    });
    expect(s.analytics().lookthrough.funds[0]?.status).toBe('unavailable');
    await expect(s.addFundReport('holdings.xlsx', mf)).rejects.toThrow(/isn’t a monthly portfolio/);

    const workbook = new Uint8Array(
      readFileSync(join(prices, '../fund-holdings/fixtures/ppfas.xls')),
    );
    const added = await s.addFundReport('PPFAS_Monthly_Portfolio.xls', workbook);

    expect(added).toMatchObject({
      asOf: '2026-09-30',
      skipped: [],
      funds: ['Parag Parikh ELSS Tax Saver Fund Direct Growth'],
    });
    const used = () => s.analytics().lookthrough.funds[0];

    expect(used()).toMatchObject({ source: 'file', sourceUrl: '', asOf: '2026-09-30' });
    expect(s.analytics().reference.addedReports).toEqual({
      schemes: added.schemes,
      newest: '2026-09-30',
    });

    // The relay is offline: a failed refresh and a new unlock keep the added report.
    await s.refreshPrices(true);
    s.lock();
    await s.unlock(vaultId, { passphrase: 'pw' });
    expect(used()).toMatchObject({ source: 'file', status: 'available' });

    await s.removeAddedFundReports();
    s.lock();
    await s.unlock(vaultId, { passphrase: 'pw' });
    expect(used()?.status).toBe('unavailable');
    expect(s.analytics().reference.addedReports).toEqual({ schemes: 0 });
  });
});

describe('loans', () => {
  async function family() {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const memberId = s.list('member')[0]!.id;

    return { s, memberId };
  }

  it('adds what you are owed to net worth, takes off repayments and settles', async () => {
    const { s, memberId } = await family();
    const id = await s.addLoan({
      memberId,
      direction: 'lent',
      party: 'Sample friend',
      amount: 50_000,
      date: '2026-09-01',
      due: '2026-12-31',
      note: 'For a laptop',
    });
    let overview = await s.overview();

    expect(overview).toMatchObject({
      netWorth: 50_000,
      investments: 0,
      owedToYou: 50_000,
      youOwe: 0,
      invested: 0,
      gain: 0,
      realised: 0,
      loans: 1,
    });
    expect(overview.allocation.assetClass).toEqual([['Owed to you', 50_000]]);
    expect(overview.allocation.member).toEqual([['Asha', 50_000]]);

    await s.addLoanEntry({ loanId: id, type: 'repayment', amount: 20_000, date: '2026-10-01' });
    expect(s.loan(id)?.loan).toMatchObject({ balance: 30_000, repaid: 20_000, open: true });
    expect((await s.overview()).netWorth).toBe(30_000);
    await expect(
      s.addLoanEntry({ loanId: id, type: 'repayment', amount: 40_000, date: '2026-10-02' }),
    ).rejects.toThrow('That’s more than the ₹30,000 still owed');

    await s.closeLoan(id, 'repayment', '2026-10-20');
    const settled = s.loan(id)!;

    expect(settled.loan).toMatchObject({ balance: 0, open: false, settled: '2026-10-20' });
    expect(settled.entries.map((e) => [e.type, e.amount])).toEqual([
      ['advance', 50_000],
      ['repayment', 20_000],
      ['repayment', 30_000],
    ]);
    overview = await s.overview();
    expect(overview).toMatchObject({ netWorth: 0, owedToYou: 0, loans: 1 });
    expect(s.loans()).toMatchObject({ owedToYou: 0, youOwe: 0, loans: [{ id, open: false }] });
  });

  it('takes what you owe off net worth, and writes off or deletes a loan', async () => {
    const { s, memberId } = await family();
    const id = await s.addLoan({
      memberId,
      direction: 'borrowed',
      party: 'Sample relative',
      amount: 10_000,
      date: '2026-08-01',
    });

    expect(await s.overview()).toMatchObject({ netWorth: -10_000, youOwe: 10_000 });
    expect((await s.overview()).allocation.assetClass).toEqual([]);
    await s.addLoanEntry({ loanId: id, type: 'advance', amount: 5_000, date: '2026-09-01' });
    expect(s.loans().youOwe).toBe(15_000);

    await s.closeLoan(id, 'write-off', '2026-10-01');
    expect(s.loan(id)?.loan).toMatchObject({ writtenOff: 15_000, open: false });
    expect((await s.overview()).netWorth).toBe(0);

    await s.removeLoan(id);
    expect(s.loan(id)).toBeNull();
    expect(s.list('loanEntry')).toEqual([]);
  });

  it('refuses bad loans and entries', async () => {
    const { s, memberId } = await family();
    const loan = {
      memberId,
      direction: 'lent',
      party: 'Sample friend',
      date: '2026-09-01',
    } as const;

    await expect(s.addLoan({ ...loan, party: ' ', amount: 100 })).rejects.toThrow(
      'Type who the loan is with',
    );
    await expect(s.addLoan({ ...loan, amount: 0 })).rejects.toThrow('Enter an amount above zero');
    await expect(s.addLoan({ ...loan, amount: 100, due: '2026-01-01' })).rejects.toThrow(
      'The due date is before the loan started on 2026-09-01',
    );
    expect(s.list('loan')).toEqual([]);

    const id = await s.addLoan({ ...loan, amount: 1_000 });
    const [advance] = s.loan(id)!.entries;

    await s.addLoanEntry({ loanId: id, type: 'repayment', amount: 400, date: '2026-09-10' });
    await expect(s.removeLoanEntry(advance!.id)).rejects.toThrow('Delete a payment first');
    await expect(s.removeMember(memberId)).rejects.toThrow('A portfolio needs at least one member');
    await s.saveLoan({ ...s.list('loan')[0]!, party: 'Sample neighbour', due: '2026-11-15' });
    expect(s.loan(id)?.loan).toMatchObject({ party: 'Sample neighbour', due: '2026-11-15' });
  });

  it('keeps a member with loans until the loans go', async () => {
    const { s } = await family();

    await s.save('member', { id: 'mem_2', name: 'Ravi' });
    const id = await s.addLoan({
      memberId: 'mem_2',
      direction: 'lent',
      party: 'Sample friend',
      amount: 1_000,
      date: '2026-09-01',
    });

    await expect(s.removeMember('mem_2')).rejects.toThrow('Remove Ravi’s loans first');
    expect(s.loans({ memberId: 'mem_2' }).owedToYou).toBe(1_000);
    expect((await s.overview({ memberId: 'mem_2' })).netWorth).toBe(1_000);
    await s.removeLoan(id);
    await s.removeMember('mem_2');
  });

  it('shows overdue and upcoming loans', async () => {
    const { s, memberId } = await family();
    const base = { memberId, direction: 'lent', amount: 1_000, date: '2026-09-01' } as const;

    await s.addLoan({ ...base, party: 'Sample friend', due: '2026-10-01' });
    await s.addLoan({ ...base, party: 'Sample neighbour', due: '2026-11-01' });

    expect((await s.checks()).filter((c) => c.type === 'loan.overdue')).toHaveLength(1);
    expect(s.upcoming(30)).toEqual([
      {
        date: '2026-11-01',
        kind: 'loan due',
        name: 'Sample neighbour owes you',
        amount: 1_000,
        estimated: false,
      },
    ]);
  });

  it('keeps loans through a backup and restore', async () => {
    const { s, memberId } = await family();

    await s.addLoan({
      memberId,
      direction: 'lent',
      party: 'Sample friend',
      amount: 2_500,
      date: '2026-09-01',
    });
    const backup = await s.backup();
    const phone = service();

    await phone.restore(backup.bytes, { passphrase: 'pw' });
    expect(phone.loans()).toMatchObject({ owedToYou: 2_500, loans: [{ party: 'Sample friend' }] });
  });

  it('includes sample loans in the sample data', async () => {
    const s = service();

    await s.demo();
    const loans = s.loans();

    expect(loans.loans.map((l) => l.direction).sort()).toEqual(['borrowed', 'lent']);
    expect(loans.owedToYou).toBeGreaterThan(0);
    expect(s.analytics().assetSplit.slices.some((x) => x.label === 'Owed to you')).toBe(true);
  });
});

describe('cards', () => {
  async function family() {
    const s = service();

    await s.create('Family', 'Asha', 'pw');
    const memberId = s.list('member')[0]!.id;

    return { s, memberId };
  }

  const firstBill = {
    statementDate: '2026-09-15',
    dueDate: '2026-10-05',
    amount: 12_000,
    minimumDue: 600,
  };

  it('takes what is left to pay off net worth, through part and full payments', async () => {
    const { s, memberId } = await family();
    const id = await s.addCard({
      memberId,
      bank: ' Sample Bank ',
      name: 'Travel card',
      limit: 100_000,
      bill: firstBill,
    });

    expect(await s.overview()).toMatchObject({ netWorth: -12_000, cardDues: 12_000, cards: 1 });
    expect(s.card(id)?.card).toMatchObject({
      bank: 'Sample Bank',
      due: 12_000,
      overdue: true,
      limitUsed: 0.12,
      bill: { state: 'unpaid', left: 12_000 },
    });

    await s.addCardPayment({ cardId: id, amount: 600, date: '2026-09-20' });
    expect(s.card(id)?.card.bill).toMatchObject({ paid: 600, left: 11_400, state: 'minimum' });

    await s.addBill({
      cardId: id,
      statementDate: '2026-10-15',
      dueDate: '2026-11-04',
      amount: 13_000,
      minimumDue: 650,
    });
    expect(s.cards()).toMatchObject({
      dues: 13_000,
      nextDue: '2026-11-04',
      cards: [{ id, overdue: false }],
    });

    await s.addCardPayment({ cardId: id, amount: 13_000, date: '2026-10-20' });
    const detail = s.card(id)!;

    expect(detail.card).toMatchObject({ due: 0, bill: { state: 'paid' } });
    expect(detail.bills.map((b) => [b.statementDate, b.state])).toEqual([
      ['2026-10-15', 'paid'],
      ['2026-09-15', 'minimum'],
    ]);
    expect(detail.payments.map((p) => p.amount)).toEqual([13_000, 600]);
    expect((await s.overview()).netWorth).toBe(0);
  });

  it('closes, reopens and deletes a card with its history', async () => {
    const { s, memberId } = await family();
    const id = await s.addCard({
      memberId,
      bank: 'Sample Bank',
      name: 'Old card',
      bill: firstBill,
    });

    await expect(s.closeCard(id, '2026-10-22')).rejects.toThrow(
      'Pay what’s left before closing the card',
    );
    await s.addCardPayment({ cardId: id, amount: 12_000, date: '2026-10-01' });
    await s.closeCard(id, '2026-10-22');
    expect(s.cards().cards[0]).toMatchObject({ id, closed: '2026-10-22' });
    await s.saveCard({ id, memberId, bank: 'Sample Bank', name: 'Retired card' });
    expect(s.card(id)?.card).toMatchObject({ name: 'Retired card', closed: '2026-10-22' });
    await s.reopenCard(id);
    expect(s.card(id)?.card.closed).toBeUndefined();

    await s.removeCard(id);
    expect(s.card(id)).toBeNull();
    expect(s.list('cardBill')).toEqual([]);
    expect(s.list('cardPayment')).toEqual([]);
    expect((await s.overview()).cards).toBe(0);
  });

  it('refuses bad cards, bills and payments, and deletes bills and payments', async () => {
    const { s, memberId } = await family();

    await expect(s.addCard({ memberId, bank: '', name: 'Travel card' })).rejects.toThrow(
      'Type the bank',
    );
    await expect(
      s.addCard({
        memberId,
        bank: 'Sample Bank',
        name: 'Travel card',
        bill: { ...firstBill, minimumDue: 20_000 },
      }),
    ).rejects.toThrow('The minimum due can’t be more than the bill');
    const id = await s.addCard({ memberId, bank: 'Sample Bank', name: 'Travel card' });

    await expect(s.addCardPayment({ cardId: id, amount: 500, date: '2026-10-01' })).rejects.toThrow(
      'Add the bill first',
    );
    const billId = await s.addBill({ cardId: id, ...firstBill });

    await expect(s.addBill({ cardId: id, ...firstBill })).rejects.toThrow(
      'There’s already a bill dated 2026-09-15',
    );
    await s.addCardPayment({ cardId: id, amount: 500, date: '2026-10-01' });
    await s.removeCardPayment(s.card(id)!.payments[0]!.id);
    await s.removeBill(billId);
    expect(s.card(id)).toMatchObject({ bills: [], payments: [], card: { due: 0 } });
  });

  it('keeps a member with cards until the cards go', async () => {
    const { s } = await family();

    await s.save('member', { id: 'mem_2', name: 'Ravi' });
    const id = await s.addCard({
      memberId: 'mem_2',
      bank: 'Sample Bank',
      name: 'Travel card',
      bill: firstBill,
    });

    await expect(s.removeMember('mem_2')).rejects.toThrow('Remove Ravi’s cards first');
    expect(s.cards({ memberId: 'mem_2' }).dues).toBe(12_000);
    expect(s.cards({ memberId: s.list('member')[0]!.id }).dues).toBe(0);
    await s.removeCard(id);
    await s.removeMember('mem_2');
  });

  it('shows bills due soon in Coming up, with overdue ones first, and no checks', async () => {
    const { s, memberId } = await family();

    await s.addCard({ memberId, bank: 'Sample Bank', name: 'Travel card', bill: firstBill });
    await s.addCard({
      memberId,
      bank: 'Demo Bank',
      name: 'Shopping card',
      bill: { statementDate: '2026-10-10', dueDate: '2026-10-30', amount: 4_000, minimumDue: 200 },
    });

    expect(s.upcoming(30)).toEqual([
      {
        date: '2026-10-05',
        kind: 'card bill',
        name: 'Sample Bank Travel card',
        amount: 12_000,
        estimated: false,
        overdue: true,
      },
      {
        date: '2026-10-30',
        kind: 'card bill',
        name: 'Demo Bank Shopping card',
        amount: 4_000,
        estimated: false,
      },
    ]);
    expect((await s.checks()).map((c) => c.type)).toEqual(['backup.none']);
  });

  it('keeps cards through a backup and restore', async () => {
    const { s, memberId } = await family();

    await s.addCard({ memberId, bank: 'Sample Bank', name: 'Travel card', bill: firstBill });
    const backup = await s.backup();
    const phone = service();

    await phone.restore(backup.bytes, { passphrase: 'pw' });
    expect(phone.cards()).toMatchObject({ dues: 12_000, cards: [{ name: 'Travel card' }] });
  });

  it('includes sample cards in the sample data', async () => {
    const s = service();

    await s.demo();
    const cards = s.cards();

    expect(cards.cards.map((c) => c.bill?.state).sort()).toEqual(['minimum', 'paid']);
    expect(cards.dues).toBe(9_310);
    expect((await s.overview()).cardDues).toBe(9_310);
    expect(s.analytics().cardDues).toBe(9_310);
  });
});
