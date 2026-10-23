// SPDX-License-Identifier: AGPL-3.0-only
// The data worker's logic: it holds the key, the log and the state, and answers the screens.
// Kept free of Comlink and IndexedDB so it can be tested in Node.
import {
  activeWraps,
  addDays,
  addFundReports,
  addPasskey,
  all,
  type AllocationTargets,
  type AmfiScheme,
  amountProblem,
  applyPlan,
  benchmarks,
  type CapFile,
  checks as runChecks,
  createVault,
  daysBetween,
  DEFAULT_RATES,
  deleteEvent,
  dismissalId,
  type EngineCache,
  engineCache,
  type EntityMap,
  type EntityName,
  entryRemovalProblem,
  evaluate,
  excelExporter,
  failedIndexData,
  FeedClient,
  fromMs,
  FUND_SOURCES,
  type FundHoldingsFile,
  type FundPortfolio,
  type FundSourceId,
  fyOf,
  get,
  history,
  type Holding,
  importApplyEvent,
  importers,
  type ImportPlan,
  importRevertEvent,
  income,
  type IndexDataFile,
  inputFile,
  jsonExporter,
  type KdfParams,
  type Keyring,
  type Loan,
  LOAN_EPS,
  type LoanEntry,
  loanEntryProblem,
  loanProblem,
  loansDue,
  type LoanStatus,
  loanStatuses,
  loanTotals,
  type LocalStore,
  makeBackup,
  MemoryLocalStore,
  mergeFundHoldings,
  mergeIndexData,
  mergeNseReference,
  newRecoveryCode,
  NSE_LIST_INDEX,
  type NseReferenceFile,
  openChunk,
  outstanding,
  OWED_TO_YOU,
  parseHlc,
  pickImporter,
  planImport,
  portfolioAnalytics,
  type Price,
  PriceBook,
  priceKeys,
  putEvent,
  randomId,
  type RateTables,
  readBackup,
  readFundReport,
  RelayClient,
  type RelayLatest,
  type RelayPart,
  replay,
  restoreBackup,
  revokeWrap,
  roundAmount,
  sealChunk,
  setPassphrase,
  sha256Hex,
  type State,
  summary,
  templateExporter,
  today as localToday,
  unlockWithPasskey,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
  upcoming,
  upToDate,
  validAllocationTargets,
  VaultLog,
  verifyKeyring,
  versionOf,
  withAddedReports,
} from '@pv/core';

import { LOAN_WORDS } from '../loans.ts';

import type {
  AccountDto,
  AddedFundReportDto,
  AnalyticsDto,
  BatchDto,
  FileOut,
  Filter,
  HoldingDetailDto,
  HoldingDto,
  LoanDetailDto,
  LoanDto,
  LoansDto,
  NewLoanInput,
  OverviewDto,
  PlanDto,
  PrepareResult,
  PriceStatusDto,
  UnlockMethodDto,
  UpcomingDto,
  VaultSummary,
} from './dto.ts';
import { readPdf } from './pdf.ts';
import type { DeviceStorage } from './storage.ts';

export type Secret =
  | { passphrase: string }
  | { recoveryCode: string }
  | { credentialId: string; prfOutput: Uint8Array };

interface PriceCache {
  fetched: string;
  latest: Price[];
  history: Price[];
  historyFetched?: string;
  schemes: AmfiScheme[];
  nse?: NseReferenceFile | undefined;
  fundHoldings?: FundHoldingsFile | undefined;
  fundHoldingsFetched?: string | undefined;
  /** Every NSE and BSE index level, with the closes saved so far. */
  indices?: IndexDataFile | undefined;
  /** AMFI's stock categorisation, and why the last attempt to refresh it failed. */
  caps?: CapFile | undefined;
  capsFailure?: string | undefined;
  rates?: RateTables;
}

interface OpenVault {
  vaultId: string;
  name: string;
  dk: CryptoKey;
  local: LocalStore;
  log: VaultLog;
  state: State;
  cache: EngineCache;
  book: PriceBook;
  prices: PriceCache;
  /** Fund reports added by hand, saved apart from the price cache so a refresh never drops them. */
  addedFunds: FundPortfolio[];
  demo: boolean;
  plans: Map<
    string,
    {
      plan: ImportPlan;
      draft: Parameters<typeof planImport>[1];
      options: Parameters<typeof planImport>[2];
    }
  >;
}

export interface Env {
  fetch: typeof fetch;
  now: () => Date;
  /** The app's own price relay, such as https://example.pages.dev/api/prices/. */
  relayUrl: string;
  /** A price feed this build reads instead of the relay; Settings can change it. */
  feedUrl?: string;
  /** Cheaper Argon2id settings for tests. */
  kdf?: Omit<KdfParams, 'salt'>;
}

const PRICE_REFRESH_MS = 6 * 3600_000;

const PART_NAMES: Record<RelayPart, string> = {
  funds: 'fund NAVs',
  stocks: 'stock prices',
  fx: 'the USD rate',
};

export class LockedError extends Error {
  override name = 'LockedError';
}

export class DataService {
  private open?: OpenVault;
  private lockTimer?: ReturnType<typeof setTimeout>;
  private autoLockMs = 5 * 60_000;
  onLock?: () => void;

  constructor(
    private storage: DeviceStorage,
    private env: Env,
  ) {}

  // ---- vaults and unlocking ----

  async vaults(): Promise<VaultSummary[]> {
    const out: VaultSummary[] = [];

    for (const v of await this.storage.vaults()) {
      const ring = await (await this.storage.open(v.vaultId)).getMeta<Keyring>('keyring');
      const passkeys = ring
        ? activeWraps(ring, 'passkey').map((w) => ({
            credentialId: w.credentialId!,
            prfSalt: w.prfSalt!,
            label: w.label ?? '',
          }))
        : [];

      out.push({ ...v, passkeys });
    }

    return out.sort((a, b) => a.created.localeCompare(b.created));
  }

  async create(
    name: string,
    memberName: string,
    passphrase: string,
  ): Promise<{ vaultId: string; recoveryCode: string }> {
    const now = this.env.now();
    const { keyring, dk, recoveryCode } = await createVault({
      passphrase,
      now,
      ...(this.env.kdf ? { kdf: this.env.kdf } : {}),
    });
    const vaultId = keyring.vaultId;

    await this.storage.addVault({ vaultId, name, created: now.toISOString() });
    const local = await this.storage.open(vaultId);

    await this.attach(vaultId, name, dk, local, keyring, false);
    await this.save('member', { id: `mem_${vaultId.slice(6, 16)}`, name: memberName });

    return { vaultId, recoveryCode };
  }

  /** A separate vault with sample data, kept in memory only. */
  async demo(): Promise<void> {
    const { keyring, dk } = await createVault({
      passphrase: 'demo',
      kdf: { alg: 'argon2id', m: 256, t: 1, p: 1 },
    });

    await this.attach(keyring.vaultId, 'Sample data', dk, new MemoryLocalStore(), keyring, true);
    const { sampleEvents } = await import('./sample.ts');

    await this.open!.log.append(sampleEvents(this.open!.log.clock, localToday(this.env.now())));
    this.refresh();
  }

  async unlock(vaultId: string, secret: Secret): Promise<void> {
    const entry = (await this.storage.vaults()).find((v) => v.vaultId === vaultId);

    if (!entry) {
      throw new Error('No such vault on this device');
    }

    const local = await this.storage.open(vaultId);
    const keyring = await local.getMeta<Keyring>('keyring');

    if (!keyring) {
      throw new Error('This vault has no keyring on this device');
    }

    const dk = await unlockSecret(keyring, secret);

    await this.attach(vaultId, entry.name, dk, local, keyring, false);
  }

  private async attach(
    vaultId: string,
    name: string,
    dk: CryptoKey,
    local: LocalStore,
    keyring: Keyring,
    demo: boolean,
  ) {
    const log = await VaultLog.open(local, dk, keyring);
    const empty: PriceCache = { fetched: '', latest: [], history: [], schemes: [] };
    const prices = await this.loadSealed(vaultId, dk, local, 'cache/prices', empty);
    const addedFunds = await this.loadSealed<FundPortfolio[]>(
      vaultId,
      dk,
      local,
      'added/fund-reports',
      [],
    );

    this.open = {
      vaultId,
      name,
      dk,
      local,
      log,
      prices,
      addedFunds,
      demo,
      state: replay([]),
      cache: engineCache(replay([])),
      book: new PriceBook(),
      plans: new Map(),
    };
    this.refresh();
    this.autoLockMs = ((await local.getMeta<number>('autoLockMinutes')) ?? 5) * 60_000;
    this.touch();
  }

  lock(): void {
    this.open = undefined;
    clearTimeout(this.lockTimer);
    this.onLock?.();
  }

  isUnlocked(): boolean {
    return this.open !== undefined;
  }

  /** Called on user activity; the vault locks after the idle time. */
  touch(): void {
    if (!this.open) {
      return;
    }

    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => this.lock(), this.autoLockMs);
  }

  async setAutoLock(minutes: number): Promise<void> {
    const v = this.need();
    const clamped = Math.min(60, Math.max(1, Math.round(minutes)));

    await v.local.setMeta('autoLockMinutes', clamped);
    this.autoLockMs = clamped * 60_000;
    this.touch();
  }

  async autoLockMinutes(): Promise<number> {
    return (await this.need().local.getMeta<number>('autoLockMinutes')) ?? 5;
  }

  current(): { vaultId: string; name: string; demo: boolean; readOnly: boolean } | null {
    const v = this.open;

    return v
      ? { vaultId: v.vaultId, name: v.name, demo: v.demo, readOnly: v.state.readOnly }
      : null;
  }

  async removeVault(vaultId: string): Promise<void> {
    if (this.open?.vaultId === vaultId) {
      this.lock();
    }

    await this.storage.removeVault(vaultId);
  }

  // ---- unlock methods ----

  unlockMethods(): UnlockMethodDto[] {
    return activeWraps(this.need().log.keyring).map((w) => ({
      id: w.id,
      type: w.type,
      ...(w.label ? { label: w.label } : {}),
      updated: w.updated,
    }));
  }

  async changePassphrase(passphrase: string): Promise<void> {
    const v = this.need();

    await v.log.setKeyring(
      await setPassphrase(v.log.keyring, v.dk, passphrase, { kdf: this.env.kdf }),
    );
  }

  async replaceRecoveryCode(): Promise<string> {
    const v = this.need();
    const { keyring, code } = await newRecoveryCode(v.log.keyring, v.dk, this.env.now());

    await v.log.setKeyring(keyring);

    return code;
  }

  async addPasskey(
    credentialId: string,
    prfSalt: string,
    prfOutput: Uint8Array,
    label: string,
  ): Promise<void> {
    const v = this.need();
    const ring = await addPasskey(
      v.log.keyring,
      v.dk,
      { credentialId, prfSalt, prfOutput: new Uint8Array(prfOutput), label },
      this.env.now(),
    );

    await v.log.setKeyring(ring);
  }

  async removeUnlockMethod(wrapId: string): Promise<void> {
    const v = this.need();
    const wraps = activeWraps(v.log.keyring);
    const target = wraps.find((w) => w.id === wrapId);

    if (!target) {
      return;
    }

    if (target.type === 'passphrase' && wraps.filter((w) => w.type === 'passphrase').length === 1) {
      throw new Error('The passphrase can be changed, not removed');
    }

    await v.log.setKeyring(await revokeWrap(v.log.keyring, v.dk, wrapId));
  }

  // ---- reading ----

  private need(): OpenVault {
    if (!this.open) {
      throw new LockedError('The vault is locked');
    }

    return this.open;
  }

  private refresh(): void {
    const v = this.need();

    v.state = replay(v.log.events());
    v.cache = engineCache(v.state);
    const latest = [...v.prices.history, ...v.prices.latest];

    v.book = new PriceBook(latest, all(v.state, 'manualPrice'), all(v.state, 'snapshot'));
  }

  private today(): string {
    return localToday(this.env.now());
  }

  private rates(): RateTables {
    return this.open?.prices.rates ?? DEFAULT_RATES;
  }

  private opts() {
    const v = this.need();

    return { rates: this.rates(), cache: v.cache };
  }

  private holdingDto(h: Holding): HoldingDto {
    const v = this.need();
    const balance = ['fd', 'ppf', 'epf', 'eps', 'cash'].includes(h.instrument.kind);
    const units = balance ? null : h.position.units;
    const groups = all(v.state, 'group');

    return {
      key: h.key,
      accountId: h.account.id,
      accountLabel: h.account.label,
      memberId: h.memberId,
      memberName: get(v.state, 'member', h.memberId)?.name ?? '',
      instrumentId: h.instrument.id,
      name: h.instrument.name,
      kind: h.instrument.kind,
      assetClass: h.instrument.assetClass,
      groups: h.groupIds.map((g) => groups.find((x) => x.id === g)?.name ?? g),
      status: h.status,
      units,
      price: units ? h.value / units : null,
      ...(h.priceDate ? { priceDate: h.priceDate } : {}),
      value: h.value,
      invested: h.invested,
      gain: h.gain,
      gainPct: h.gainPct,
      xirr: h.xirr,
      xirrEstimate: h.xirrEstimate,
      ...(h.xirrAsOf ? { xirrAsOf: h.xirrAsOf } : {}),
      estimate: h.estimate,
      weight: h.weight,
      ...(h.position.entries[0] ? { firstDate: h.position.entries[0].date } : {}),
    };
  }

  private upcomingDto(days: number): UpcomingDto[] {
    const v = this.need();

    const date = this.today();
    const holdings: UpcomingDto[] = upcoming(v.state, v.book, date, days, this.opts()).map((u) => ({
      date: u.date,
      kind: u.kind,
      name: get(v.state, 'instrument', u.instrumentId)?.name ?? '',
      ...(u.amount !== undefined ? { amount: u.amount } : {}),
      estimated: u.estimated,
    }));
    const loans: UpcomingDto[] = loansDue(loanStatuses(v.state, date), date, days).map((d) => ({
      date: d.date,
      kind: 'loan due',
      name: LOAN_WORDS[d.loan.direction].owes(d.loan.party),
      amount: d.amount,
      estimated: false,
    }));

    return [...holdings, ...loans].sort((a, b) => a.date.localeCompare(b.date));
  }

  private async deviceFacts() {
    const v = this.need();
    const lastBackup = await v.local.getMeta<string>('lastBackup');
    let persisted: boolean | undefined;

    try {
      persisted = await navigator.storage?.persisted?.();
    } catch {
      persisted = undefined;
    }

    return {
      ...(lastBackup ? { lastBackup } : {}),
      ...(persisted !== undefined ? { persisted } : {}),
      ...(v.demo ? { lastBackup: this.today() } : {}),
    };
  }

  async overview(filter: Filter = {}, range: '1m' | '1y' | 'all' = '1y'): Promise<OverviewDto> {
    const v = this.need();
    const date = this.today();
    const s = summary(v.state, v.book, date, filter, this.opts());
    const names = (map: Record<string, number>, name: (id: string) => string) =>
      Object.entries(map)
        .map(([k, n]): [string, number] => [name(k), n])
        .sort((a, b) => b[1] - a[1]);
    const from =
      range === '1m'
        ? addDays(date, -30)
        : range === '1y'
          ? addDays(date, -365)
          : (s.firstFlow ?? addDays(date, -365));
    const start = s.firstFlow && s.firstFlow > from ? s.firstFlow : from;
    const points = s.firstFlow
      ? history(v.state, v.book, start, date, {
          ...this.opts(),
          filter,
          step: range === 'all' ? 'month' : 'day',
        })
      : [];

    // What you're owed is a slice where it fits; what you owe never is.
    const owed = s.loans.owedToYouByMember;
    const assetClass: Record<string, number> = { ...s.allocation.assetClass };
    const member = { ...s.allocation.member };
    const group = { ...s.allocation.group };

    if (s.loans.owedToYou > 0) {
      assetClass[OWED_TO_YOU] = s.loans.owedToYou;
      group[''] = (group[''] ?? 0) + s.loans.owedToYou;

      for (const [id, n] of Object.entries(owed)) {
        member[id] = (member[id] ?? 0) + n;
      }
    }

    return {
      date,
      netWorth: s.netWorth,
      investments: s.investments,
      owedToYou: s.loans.owedToYou,
      youOwe: s.loans.youOwe,
      invested: s.invested,
      netInvested: s.netInvested,
      totalGain: s.totalGain,
      xirr: s.xirr,
      xirrEstimate: s.xirrEstimate,
      absoluteReturn: s.absoluteReturn,
      ...(s.firstFlow ? { firstFlow: s.firstFlow } : {}),
      allocation: {
        assetClass: names(assetClass, (k) => k),
        member: names(member, (k) => get(v.state, 'member', k)?.name ?? k),
        group: names(group, (k) => (k ? (get(v.state, 'group', k)?.name ?? k) : 'Not in a group')),
      },
      history: points.map((p) => ({
        date: p.date,
        value: p.value,
        netInvested: p.netInvested,
        costOnly: p.costOnly,
      })),
      upcoming: this.upcomingDto(30),
      checks: await this.checks(),
      holdings: s.holdings.length,
      loans: loanStatuses(v.state, date, filter).length,
      ...(v.prices.fetched ? { pricesAsOf: v.prices.fetched } : {}),
      readOnly: v.state.readOnly,
    };
  }

  holdings(filter: Filter = {}): HoldingDto[] {
    const v = this.need();

    return summary(v.state, v.book, this.today(), filter, this.opts()).holdings.map((h) =>
      this.holdingDto(h),
    );
  }

  analytics(filter: Filter = {}): AnalyticsDto {
    const v = this.need();
    const date = this.today();
    const s = summary(v.state, v.book, date, filter, this.opts());
    const portfolios = withAddedReports(v.prices.fundHoldings?.portfolios ?? [], v.addedFunds);

    return {
      ...portfolioAnalytics(
        s.holdings,
        date,
        {
          schemes: v.prices.schemes,
          stocks: v.prices.nse?.rows ?? [],
          portfolios,
          retained: v.prices.fundHoldings?.retained,
          caps: v.prices.caps?.rows ?? [],
        },
        s.loans,
      ),
      targets:
        this.setting<AllocationTargets>(`analyticsTargets:${filter.memberId || 'all'}`) ?? null,
      indices: benchmarks(v.prices.indices, this.listedMembers()),
      reference: {
        ...(v.prices.nse ? { nseDate: v.prices.nse.date } : {}),
        nseStale:
          !v.prices.nse || !!v.prices.nse.stale?.length || date > addDays(v.prices.nse.date, 7),
        amfiSchemes: v.prices.schemes.length,
        ...(v.prices.caps
          ? {
              caps: {
                asOf: v.prices.caps.asOf,
                date: v.prices.caps.date,
                url: v.prices.caps.url,
                companies: v.prices.caps.rows.length,
                // A new list covers each half-year and comes out a few days after it ends.
                stale: daysBetween(v.prices.caps.asOf, date) > 200,
              },
            }
          : {}),
        ...(v.prices.capsFailure ? { capsFailure: v.prices.capsFailure } : {}),
        fundReports: portfolios.length,
        addedReports: {
          schemes: v.addedFunds.length,
          ...(v.addedFunds.length
            ? {
                newest: v.addedFunds
                  .map((p) => p.asOf)
                  .sort()
                  .at(-1)!,
              }
            : {}),
        },
        fundFailures: (v.prices.fundHoldings?.failures ?? []).map((f) => ({
          ...f,
          label: Object.hasOwn(FUND_SOURCES, f.source)
            ? FUND_SOURCES[f.source as FundSourceId].label
            : 'Fund reports',
        })),
      },
    };
  }

  /** How many members NSE's constituent lists give each of their indices. */
  private listedMembers(): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const row of this.need().prices.nse?.rows ?? []) {
      const id = NSE_LIST_INDEX[row.marketCap];

      counts[id] = (counts[id] ?? 0) + 1;
    }

    return counts;
  }

  async saveAllocationTargets(targets: AllocationTargets, memberId?: string): Promise<void> {
    if (!validAllocationTargets(targets)) {
      throw new Error('Targets must be between 0 and 100% and total 100%.');
    }

    await this.save('setting', { id: `analyticsTargets:${memberId || 'all'}`, value: targets });
  }

  holding(key: string): HoldingDetailDto | null {
    const v = this.need();
    const date = this.today();
    const h = evaluate(v.state, v.book, date, this.opts()).find((x) => x.key === key);

    if (!h) {
      return null;
    }

    const first = h.position.entries[0]?.date ?? date;
    const filter = { accountId: h.account.id, instrumentId: h.instrument.id };
    const single = history(v.state, v.book, first, date, { ...this.opts(), step: 'month', filter });

    return {
      holding: this.holdingDto(h),
      entries: h.position.entries,
      lots: h.position.lots,
      history: single.map((p) => ({
        date: p.date,
        value: p.value,
        netInvested: p.netInvested,
        costOnly: p.costOnly,
      })),
    };
  }

  income(fy: number) {
    const v = this.need();

    return income(v.state, v.book, fy, this.opts()).map((r) => ({
      ...r,
      memberName: get(v.state, 'member', r.memberId)?.name ?? '',
      name: get(v.state, 'instrument', r.instrumentId)?.name ?? '',
    }));
  }

  incomeYears(): number[] {
    const v = this.need();
    const dates = all(v.state, 'transaction').map((t) => t.date);
    const first = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : this.today();
    const years: number[] = [];

    for (let fy = fyOf(this.today()); fy >= fyOf(first); fy--) {
      years.push(fy);
    }

    return years;
  }

  upcoming(days = 90): UpcomingDto[] {
    return this.upcomingDto(days);
  }

  async checks() {
    const v = this.need();
    const settings = get(v.state, 'setting', 'checks')?.value as Record<string, number> | undefined;

    return runChecks(
      v.state,
      v.book,
      this.today(),
      await this.deviceFacts(),
      settings ?? {},
      this.opts(),
    );
  }

  list<K extends EntityName>(entity: K): EntityMap[K][] {
    return all(this.need().state, entity);
  }

  setting<T>(id: string): T | undefined {
    return get(this.need().state, 'setting', id)?.value as T | undefined;
  }

  /** Accounts with their member's name and how many records each holds. */
  accounts(): AccountDto[] {
    const s = this.need().state;
    const members = new Map(all(s, 'member').map((m) => [m.id, m.name]));
    const counts = new Map<string, { transactions: number; balances: number }>();

    const count = (accountId: string) => {
      let c = counts.get(accountId);

      if (!c) {
        counts.set(accountId, (c = { transactions: 0, balances: 0 }));
      }

      return c;
    };

    for (const t of all(s, 'transaction')) {
      count(t.accountId).transactions += 1;
    }

    for (const x of all(s, 'snapshot')) {
      count(x.accountId).balances += 1;
    }

    return all(s, 'account')
      .map((a) => ({
        id: a.id,
        memberId: a.memberId,
        member: members.get(a.memberId) ?? '',
        label: a.label,
        institution: a.institution,
        ...count(a.id),
      }))
      .sort((a, b) => a.member.localeCompare(b.member) || a.label.localeCompare(b.label));
  }

  // ---- writing ----

  private writable() {
    const v = this.need();

    if (v.state.readOnly) {
      throw new Error(
        'This vault was changed by a newer version of the app. Update the app to make changes.',
      );
    }

    return v;
  }

  async save<K extends EntityName>(entity: K, value: EntityMap[K]): Promise<void> {
    const v = this.writable();
    const base = versionOf(v.state, entity, value.id);

    await v.log.append([putEvent(v.log.clock.next(), entity, value, base)]);
    this.refresh();
  }

  async remove(entity: EntityName, id: string): Promise<void> {
    const v = this.writable();

    await v.log.append([
      deleteEvent(v.log.clock.next(), entity, id, versionOf(v.state, entity, id)),
    ]);
    this.refresh();
  }

  async rename(entity: 'member' | 'account', id: string, name: string): Promise<void> {
    const text = name.trim();

    if (!text) {
      throw new Error('Type a name first');
    }

    const s = this.need().state;

    if (entity === 'member') {
      const member = get(s, 'member', id);

      if (member) {
        await this.save('member', { ...member, name: text });
      }
    } else {
      const account = get(s, 'account', id);

      if (account) {
        await this.save('account', { ...account, label: text });
      }
    }
  }

  /** Only a member without accounts can go, and a portfolio keeps at least one member. */
  async removeMember(id: string): Promise<void> {
    const s = this.need().state;
    const member = get(s, 'member', id);

    if (!member) {
      return;
    }

    if (all(s, 'member').length === 1) {
      throw new Error('A portfolio needs at least one member');
    }

    if (all(s, 'account').some((a) => a.memberId === id)) {
      throw new Error(`Remove ${member.name}’s accounts first`);
    }

    if (all(s, 'loan').some((l) => l.memberId === id)) {
      throw new Error(`Remove ${member.name}’s loans first`);
    }

    await this.remove('member', id);
  }

  /** Removes an account with its transactions and balances, and takes it out of groups. */
  async removeAccount(id: string): Promise<void> {
    const v = this.writable();
    const s = v.state;

    if (!get(s, 'account', id)) {
      return;
    }

    const drop = (entity: EntityName, key: string) =>
      deleteEvent(v.log.clock.next(), entity, key, versionOf(s, entity, key));
    const events = [
      ...all(s, 'transaction')
        .filter((t) => t.accountId === id)
        .map((t) => drop('transaction', t.id)),
      ...all(s, 'snapshot')
        .filter((x) => x.accountId === id)
        .map((x) => drop('snapshot', x.id)),
      ...all(s, 'group')
        .filter((g) => g.holdings.some((h) => h.accountId === id))
        .map((g) =>
          putEvent(
            v.log.clock.next(),
            'group',
            { ...g, holdings: g.holdings.filter((h) => h.accountId !== id) },
            versionOf(s, 'group', g.id),
          ),
        ),
      drop('account', id),
    ];

    await v.log.append(events);
    this.refresh();
  }

  // ---- loans ----

  private loanDto(s: LoanStatus): LoanDto {
    const { loan } = s;

    return {
      id: loan.id,
      memberId: loan.memberId,
      memberName: get(this.need().state, 'member', loan.memberId)?.name ?? '',
      direction: loan.direction,
      party: loan.party,
      ...(loan.due ? { due: loan.due } : {}),
      ...(loan.note ? { note: loan.note } : {}),
      advanced: s.advanced,
      repaid: s.repaid,
      writtenOff: s.writtenOff,
      balance: s.balance,
      open: s.open,
      overdue: s.overdue,
      ...(s.start ? { start: s.start } : {}),
      ...(s.settled ? { settled: s.settled } : {}),
    };
  }

  /** The loans a filter covers: open ones first, biggest first, then settled ones, latest first. */
  loans(filter: Filter = {}): LoansDto {
    const date = this.today();
    const statuses = loanStatuses(this.need().state, date, filter);
    const { owedToYou, youOwe } = loanTotals(statuses);
    const loans = statuses
      .map((s) => this.loanDto(s))
      .sort((a, b) =>
        a.open !== b.open
          ? Number(b.open) - Number(a.open)
          : a.open
            ? b.balance - a.balance
            : (b.settled ?? '').localeCompare(a.settled ?? ''),
      );

    return { date, owedToYou, youOwe, loans };
  }

  loan(id: string): LoanDetailDto | null {
    const s = loanStatuses(this.need().state, this.today()).find((x) => x.loan.id === id);

    return s ? { loan: this.loanDto(s), entries: s.entries } : null;
  }

  /** Adds a loan with the amount first lent or borrowed, and gives its ID. */
  async addLoan(input: NewLoanInput): Promise<string> {
    const v = this.writable();
    const loan = tidyLoan({ ...input, id: randomId('loan') });
    const problem = loanProblem(v.state, loan, input.date) ?? amountProblem(input.amount);

    if (problem) {
      throw new Error(problem);
    }

    const advance: LoanEntry = {
      id: randomId('lne'),
      loanId: loan.id,
      date: input.date,
      type: 'advance',
      amount: roundAmount(input.amount),
    };

    await v.log.append([
      putEvent(v.log.clock.next(), 'loan', loan),
      putEvent(v.log.clock.next(), 'loanEntry', advance),
    ]);
    this.refresh();

    return loan.id;
  }

  /** Saves a loan's details: who, whose, the due date and the note. */
  async saveLoan(loan: Loan): Promise<void> {
    const v = this.writable();
    const tidy = tidyLoan(loan);
    const problem = get(v.state, 'loan', loan.id)
      ? loanProblem(v.state, tidy)
      : 'This loan no longer exists';

    if (problem) {
      throw new Error(problem);
    }

    await this.save('loan', tidy);
  }

  /** Records more money lent or borrowed, or a repayment, which may be part of what's owed. */
  async addLoanEntry(input: Omit<LoanEntry, 'id' | 'type'> & { type: 'advance' | 'repayment' }) {
    await this.saveLoanEntry({ ...input, id: randomId('lne'), amount: roundAmount(input.amount) });
  }

  /** Settles a loan: what's still owed is paid back, or written off. */
  async closeLoan(loanId: string, type: 'repayment' | 'write-off', date: string): Promise<void> {
    const owed = outstanding(
      all(this.need().state, 'loanEntry').filter((e) => e.loanId === loanId),
    );

    if (owed <= LOAN_EPS) {
      throw new Error('Nothing is owed on this loan');
    }

    await this.saveLoanEntry({
      id: randomId('lne'),
      loanId,
      date,
      type,
      amount: roundAmount(owed),
    });
  }

  private async saveLoanEntry(entry: LoanEntry): Promise<void> {
    const problem = loanEntryProblem(this.writable().state, entry);

    if (problem) {
      throw new Error(problem);
    }

    await this.save('loanEntry', entry);
  }

  async removeLoanEntry(id: string): Promise<void> {
    const problem = entryRemovalProblem(this.writable().state, id);

    if (problem) {
      throw new Error(problem);
    }

    await this.remove('loanEntry', id);
  }

  /** Deletes a loan with its whole history, as if it never existed. */
  async removeLoan(id: string): Promise<void> {
    const v = this.writable();
    const s = v.state;

    if (!get(s, 'loan', id)) {
      return;
    }

    const drop = (entity: EntityName, key: string) =>
      deleteEvent(v.log.clock.next(), entity, key, versionOf(s, entity, key));

    await v.log.append([
      ...all(s, 'loanEntry')
        .filter((e) => e.loanId === id)
        .map((e) => drop('loanEntry', e.id)),
      drop('loan', id),
    ]);
    this.refresh();
  }

  async dismiss(checkKey: string): Promise<void> {
    await this.save('dismissal', { id: dismissalId(checkKey), checkKey });
  }

  /** Restores the other side of a sync conflict. */
  async restoreConflict(key: string): Promise<void> {
    const v = this.need();
    const conflict = v.state.conflicts.get(key);

    if (!conflict) {
      return;
    }

    if (conflict.loser.value === undefined) {
      await this.remove(conflict.entity, conflict.id);
    } else {
      await this.save(conflict.entity, conflict.loser.value as EntityMap[EntityName]);
    }
  }

  // ---- importing ----

  async prepareImport(name: string, bytes: Uint8Array, memberId: string): Promise<PrepareResult> {
    const v = this.need();
    const file = inputFile(name, bytes, readPdf);
    const picked = await pickImporter(file, importers);

    if (!picked) {
      return { kind: 'unknown', headings: await headingsOnly(file) };
    }

    const draft = await picked.importer.parse(file, {
      memberId,
      today: this.today(),
      amfi: v.prices.schemes,
    });
    const options = {
      importer: { id: picked.importer.id, version: picked.importer.version },
      file: { name, sha256: await sha256Hex(bytes), size: bytes.length },
      memberId,
      amfi: v.prices.schemes,
    };
    const plan = planImport(v.state, draft, options);
    const planId = crypto.randomUUID();

    v.plans.set(planId, { plan, draft, options });

    return { kind: 'plan', plan: this.planDto(planId, plan, picked.importer.label) };
  }

  /** Turns down fund-name matches and shows the plan again. */
  replan(planId: string, rejected: string[]): PlanDto {
    const v = this.need();
    const saved = v.plans.get(planId);

    if (!saved) {
      throw new Error('This preview has expired');
    }

    const options = { ...saved.options, rejected };
    const plan = planImport(v.state, saved.draft, options);

    v.plans.set(planId, { ...saved, plan, options });

    return this.planDto(
      planId,
      plan,
      importers.find((i) => i.id === plan.importer.id)?.label ?? plan.importer.id,
    );
  }

  async confirmImport(
    planId: string,
    exclude: number[] = [],
  ): Promise<{ written: number; batchId?: string }> {
    const v = this.need();
    const saved = v.plans.get(planId);

    if (!saved) {
      throw new Error('This preview has expired');
    }

    const items = saved.plan.items.map((item, index) =>
      exclude.includes(index) ? { ...item, include: false } : item,
    );
    const data = applyPlan({ ...saved.plan, items });

    v.plans.delete(planId);

    if (!data) {
      return { written: 0 };
    }

    await v.log.append([importApplyEvent(v.log.clock.next(), data)]);
    this.refresh();

    return { written: data.puts.length, batchId: data.batchId };
  }

  async revertImport(batchId: string): Promise<void> {
    const v = this.need();

    await v.log.append([importRevertEvent(v.log.clock.next(), batchId)]);
    this.refresh();
  }

  batches(): BatchDto[] {
    const v = this.need();

    return [...v.state.batches.values()]
      .map((b) => ({
        batchId: b.batchId,
        importer: importers.find((i) => i.id === b.importer.id)?.label ?? b.importer.id,
        fileName: b.file.name,
        date: fromMs(parseHlc(b.hlc).ms),
        ...(b.asOf ? { asOf: b.asOf } : {}),
        records: b.keys.length,
        reverted: !!b.reverted,
        kept: b.kept?.length ?? 0,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  private planDto(planId: string, plan: ImportPlan, importer: string): PlanDto {
    const v = this.need();
    const instrumentName = (id: string) =>
      plan.matches.find((m) => m.instrument.id === id)?.instrument.name ??
      get(v.state, 'instrument', id)?.name ??
      id;

    const label = (put: ImportPlan['items'][number]['put']): string => {
      switch (put.entity) {
        case 'snapshot':
          return `${instrumentName(put.value.instrumentId)}: ${put.value.units} units`;

        case 'transaction':
          return `${put.value.date} ${put.value.type} ${instrumentName(put.value.instrumentId)}`;

        case 'account':
          return `Account: ${put.value.label}`;

        case 'instrument':
          return `New: ${put.value.name}`;

        default:
          return `${put.entity}: ${'name' in put.value ? String(put.value.name) : put.id}`;
      }
    };

    return {
      planId,
      importer,
      fileName: plan.file.name,
      ...(plan.asOf ? { asOf: plan.asOf } : {}),
      memberId: plan.memberId,
      items: plan.items.map((i, index) => ({
        index,
        entity: i.put.entity,
        label: label(i.put),
        status: i.status,
        include: i.include,
        ...(i.mismatch ? { mismatch: i.mismatch } : {}),
      })),
      confirm: plan.matches
        .filter((m) => m.confirm)
        .map((m) => ({
          ref: m.ref,
          name: v.plans.get(planId)?.draft.instruments.find((d) => d.ref === m.ref)?.name ?? m.ref,
          matched:
            m.instrument.name + (m.instrument.ids.amfi ? ` (AMFI ${m.instrument.ids.amfi})` : ''),
          score: m.score ?? 0,
        })),
      ...(plan.totals ? { totals: plan.totals } : {}),
      findings: plan.findings,
      warnings: plan.warnings,
      upToDate: upToDate(plan),
    };
  }

  // ---- prices ----

  /** Data sealed on this device only, such as 'cache/prices', kept in the meta key 'cache:prices'. */
  private async loadSealed<T>(
    vaultId: string,
    dk: CryptoKey,
    local: LocalStore,
    chunk: string,
    empty: T,
  ): Promise<T> {
    const sealed = await local.getMeta<Uint8Array>(chunk.replace('/', ':'));

    if (sealed) {
      try {
        return await openChunk<T>(dk, vaultId, chunk, sealed);
      } catch {
        // Damaged prices are fetched again on the next refresh; added reports are added again.
      }
    }

    return empty;
  }

  /**
   * Reads a monthly portfolio report downloaded by hand, for a fund house the relay can't reach.
   * It's read here and sealed on this device; the newest report of each scheme is used.
   */
  async addFundReport(name: string, bytes: Uint8Array): Promise<AddedFundReportDto> {
    const v = this.need();
    const { portfolios, skipped } = await readFundReport(name, bytes, this.today());

    await this.saveAddedFunds(v, addFundReports(v.addedFunds, portfolios));
    const ids = new Set(portfolios.map((p) => p.id));

    return {
      schemes: portfolios.length,
      asOf: portfolios
        .map((p) => p.asOf)
        .sort()
        .at(-1)!,
      skipped,
      // Held funds that use one of these reports, rather than a newer fetched one.
      funds: this.analytics()
        .lookthrough.funds.filter((f) => f.reportId !== undefined && ids.has(f.reportId))
        .map((f) => f.name),
    };
  }

  /** Forgets every fund report added by hand. */
  async removeAddedFundReports(): Promise<void> {
    await this.saveAddedFunds(this.need(), []);
  }

  private async saveAddedFunds(v: OpenVault, reports: FundPortfolio[]): Promise<void> {
    await v.local.setMeta(
      'added:fund-reports',
      await sealChunk(v.dk, v.vaultId, 'added/fund-reports', reports),
    );
    v.addedFunds = reports;
  }

  /** The price feed's address, if one is set. Without one, prices come through the relay. */
  feedUrl(): string {
    return this.setting<string>('feedUrl') || this.env.feedUrl || '';
  }

  /** When prices were last fetched, and the newest fund and stock prices among them. */
  priceStatus(): PriceStatusDto {
    const v = this.need();
    const newest = (sources: string[]) =>
      v.prices.latest
        .filter((p) => sources.includes(p.source))
        .map((p) => p.date)
        .sort()
        .at(-1);

    return {
      ...(v.prices.fetched ? { fetched: v.prices.fetched } : {}),
      funds: newest(['amfi']),
      stocks: newest(['nse', 'bse']),
    };
  }

  /**
   * Fetches prices when the saved ones are older than 6 hours, or always when forced: from the
   * feed if one is set, or else through the app's own relay.
   */
  async refreshPrices(force = false): Promise<{ ok: boolean; message?: string }> {
    const v = this.need();

    if (v.demo) {
      return { ok: true };
    }

    const age = v.prices.fetched
      ? this.env.now().getTime() - Date.parse(v.prices.fetched)
      : Infinity;

    if (!force && age < PRICE_REFRESH_MS) {
      return { ok: true };
    }

    const held = new Set(all(v.state, 'instrument').flatMap(priceKeys));

    held.add('fx:USDINR');
    const saved = v.prices.fetched
      ? 'Using the prices saved earlier.'
      : 'Holdings are valued from their files until it can.';
    const feed = this.feedUrl();
    const fundTask = this.refreshFundHoldings(v.prices, force).catch(() =>
      mergeFundHoldings(undefined, v.prices.fundHoldings),
    );
    // Index levels come whatever is held; a failure keeps the saved ones and says why.
    const indexTask = this.fetchIndices().then(
      (next) => mergeIndexData(next, v.prices.indices),
      (error: Error) =>
        mergeIndexData(failedIndexData(error.message, this.today()), v.prices.indices),
    );
    // A failed cap list keeps the saved one, with its own period, and says why.
    const capsTask = this.fetchCaps(v.prices, force).then(
      (next) => ({
        caps: next ?? v.prices.caps,
        capsFailure: next ? undefined : v.prices.capsFailure,
      }),
      (error: Error) => ({ caps: v.prices.caps, capsFailure: error.message }),
    );

    const attachFunds = async (prices: PriceCache) => {
      const funds = await fundTask;

      if (funds) {
        prices.fundHoldings = funds;

        if (funds.portfolios.length && !funds.failures.length) {
          prices.fundHoldingsFetched = this.env.now().toISOString();
        }
      }

      prices.indices = await indexTask;
      Object.assign(prices, await capsTask);
      v.prices = prices;
      await v.local.setMeta(
        'cache:prices',
        await sealChunk(v.dk, v.vaultId, 'cache/prices', prices),
      );

      if (this.open === v) {
        this.refresh();
      }
    };

    try {
      const { prices, failed } = feed
        ? { prices: await this.feedPrices(v.prices, feed, held, force), failed: [] }
        : await this.relayPrices(v.prices, held);

      await attachFunds(prices);

      if (failed.length === 0) {
        return { ok: true };
      }

      const what = failed.map((f) => `${PART_NAMES[f.part]} (${f.reason})`).join(' or ');

      return { ok: false, message: `Couldn't update ${what}. ${saved}` };
    } catch (error) {
      await attachFunds({ ...v.prices });
      const from = feed ? 'the price feed' : 'prices';

      return {
        ok: false,
        message: `Couldn't fetch ${from} (${(error as Error).message}). ${saved}`,
      };
    }
  }

  /** Index levels from the feed, or through the relay when there's no feed or it has none. */
  private async fetchIndices(): Promise<IndexDataFile> {
    const ctx = { fetch: this.env.fetch };
    const feed = this.feedUrl();

    if (feed) {
      try {
        return await new FeedClient(feed).indices(ctx);
      } catch {
        /* Older feeds don't publish index data; the relay does. */
      }
    }

    return new RelayClient(this.env.relayUrl).indices(ctx);
  }

  /**
   * AMFI's cap list when stocks or funds are held and it's due: forced, never fetched, last
   * failed, or a week old. AMFI publishes a new one every January and July.
   */
  private async fetchCaps(old: PriceCache, force: boolean): Promise<CapFile | undefined> {
    const v = this.need();
    const kinds = new Set(['stock', 'mf', 'etf']);

    if (!all(v.state, 'instrument').some((i) => kinds.has(i.kind))) {
      return undefined;
    }

    const today = this.today();

    if (!force && old.caps && !old.capsFailure && today < addDays(old.caps.date, 7)) {
      return undefined;
    }

    const ctx = { fetch: this.env.fetch };
    const feed = this.feedUrl();

    if (feed) {
      try {
        return await new FeedClient(feed).caps(ctx);
      } catch {
        /* Older feeds don't publish the cap list; the relay does. */
      }
    }

    return new RelayClient(this.env.relayUrl).caps(ctx, today);
  }

  private async refreshFundHoldings(
    old: PriceCache,
    force: boolean,
  ): Promise<FundHoldingsFile | undefined> {
    const v = this.need();

    if (!all(v.state, 'instrument').some((i) => i.kind === 'mf' || i.kind === 'etf')) {
      return undefined;
    }

    const age = old.fundHoldingsFetched
      ? this.env.now().getTime() - Date.parse(old.fundHoldingsFetched)
      : Infinity;

    if (!force && age < 24 * 3600_000) {
      return undefined;
    }

    const ctx = { fetch: this.env.fetch };
    const feed = this.feedUrl();

    if (feed) {
      try {
        return mergeFundHoldings(await new FeedClient(feed).fundHoldings(ctx), old.fundHoldings);
      } catch {
        /* Older feeds can still use the app's official-source relay. */
      }
    }

    return new RelayClient(this.env.relayUrl).fundHoldings(ctx, old.fundHoldings, force);
  }

  private async feedPrices(
    old: PriceCache,
    feed: string,
    held: Set<string>,
    force: boolean,
  ): Promise<PriceCache> {
    const client = new FeedClient(feed);
    const ctx = { fetch: this.env.fetch };
    const latest = await client.latest(ctx);
    const prices: PriceCache = {
      ...old,
      fetched: this.env.now().toISOString(),
      latest: latest.prices.filter((p) => held.has(p.key)),
      schemes: latest.schemes,
      nse: mergeNseReference(latest.nse, old.nse),
    };
    const historyAge = prices.historyFetched
      ? this.env.now().getTime() - Date.parse(prices.historyFetched)
      : Infinity;

    if (force || historyAge > 24 * 3600_000) {
      prices.history = await client.history([...held], ctx).catch(() => prices.history);
      prices.historyFetched = this.env.now().toISOString();
    }

    prices.rates = await client.rates(ctx).catch(() => prices.rates ?? DEFAULT_RATES);

    return prices;
  }

  private async relayPrices(
    old: PriceCache,
    held: Set<string>,
  ): Promise<{ prices: PriceCache; failed: RelayLatest['failed'] }> {
    const latest = await new RelayClient(this.env.relayUrl).latest({ fetch: this.env.fetch });

    if (latest.failed.length === 3) {
      throw new Error([...new Set(latest.failed.map((f) => f.reason))].join('; '));
    }

    const fresh = latest.prices.filter((p) => held.has(p.key));
    const got = new Set(fresh.map((p) => p.key));
    const day = (p: Price) => `${p.key} ${p.date}`;
    const seen = new Set(fresh.map(day));
    const prices: PriceCache = {
      ...old,
      fetched: this.env.now().toISOString(),
      // A part that couldn't be fetched keeps its earlier prices.
      latest: [...old.latest.filter((p) => held.has(p.key) && !got.has(p.key)), ...fresh],
      // Without a feed, the history is the prices seen at each refresh.
      history: [...old.history.filter((p) => !seen.has(day(p))), ...fresh],
      schemes: latest.schemes.length ? latest.schemes : old.schemes,
      nse: mergeNseReference(latest.nse, old.nse),
    };

    return { prices, failed: latest.failed };
  }

  // ---- export and backup ----

  async exportFile(kind: 'excel' | 'json' | 'template'): Promise<FileOut> {
    const v = this.need();
    const exporter = { excel: excelExporter, json: jsonExporter, template: templateExporter }[kind];
    const bytes = await exporter.run({
      state: v.state,
      book: v.book,
      date: this.today(),
      rates: this.rates(),
    });
    const name =
      kind === 'template' ? 'arthly-template.xlsx' : `arthly-${this.today()}${exporter.extension}`;

    return { name, mime: exporter.mime, bytes };
  }

  async backup(): Promise<FileOut> {
    const v = this.need();
    const bytes = await makeBackup(v.log, v.local, this.env.now());

    if (!v.demo) {
      await v.local.setMeta('lastBackup', this.today());
    }

    return { name: `arthly-${this.today()}.pvault`, mime: 'application/octet-stream', bytes };
  }

  /** Restores a backup file onto this device and opens it. */
  async restore(bytes: Uint8Array, secret: Secret, name = 'Restored portfolio'): Promise<string> {
    const file = readBackup(bytes);
    const vaultId = file.keyring.vaultId;

    if ((await this.storage.vaults()).some((x) => x.vaultId === vaultId)) {
      throw new Error('This portfolio is already on this device');
    }

    const dk = await unlockSecret(file.keyring, secret);

    if (!(await verifyKeyring(file.keyring, dk))) {
      throw new Error('The backup file has been changed outside the app');
    }

    await this.storage.addVault({ vaultId, name, created: this.env.now().toISOString() });
    const local = await this.storage.open(vaultId);

    await restoreBackup(file, local, dk);
    await this.attach(vaultId, name, dk, local, file.keyring, false);

    return vaultId;
  }
}

/** The likeliest heading row of each sheet: the row with the most text cells, at least three. No values. */
/** A loan's fields as stored: trimmed text, and no empty optional fields. */
function tidyLoan(l: Omit<Loan, 'id'> & { id: string }): Loan {
  const note = l.note?.trim();

  return {
    id: l.id,
    memberId: l.memberId,
    direction: l.direction,
    party: l.party.trim(),
    ...(l.due ? { due: l.due } : {}),
    ...(note ? { note } : {}),
  };
}

async function headingsOnly(file: ReturnType<typeof inputFile>): Promise<string[]> {
  const sheets = await file.sheets().catch(() => []);
  const out: string[] = [];

  for (const sheet of sheets) {
    let best: string[] = [];

    for (const row of sheet.rows.slice(0, 40)) {
      const cells = row.filter(
        (c): c is string =>
          typeof c === 'string' &&
          c.trim() !== '' &&
          Number.isNaN(Number(c)) &&
          !/\d{4}-\d{2}-\d{2}/.test(c),
      );

      if (cells.length > best.length) {
        best = cells.map((c) => c.trim());
      }
    }

    if (best.length >= 3) {
      out.push(...best);
    }
  }

  return [...new Set(out)];
}

async function unlockSecret(keyring: Keyring, secret: Secret): Promise<CryptoKey> {
  if ('passphrase' in secret) {
    return unlockWithPassphrase(keyring, secret.passphrase);
  }

  if ('recoveryCode' in secret) {
    return unlockWithRecoveryCode(keyring, secret.recoveryCode);
  }

  return unlockWithPasskey(keyring, secret.credentialId, new Uint8Array(secret.prfOutput));
}
