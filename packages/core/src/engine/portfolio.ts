// SPDX-License-Identifier: AGPL-3.0-only
// Dashboard figures: holdings with value, gain and XIRR, portfolio totals, allocation and history.
import { all, get, type State } from '../log/replay.ts';
import type { Account, AssetClass, Group, Instrument, Snapshot } from '../model/types.ts';
import { assetTypeFor } from '../plugins/assets/index.ts';
import { addDays, daysBetween, endOfMonth, type ISODate, minDate } from '../util/dates.ts';

import type { AssetContext, HoldingStatus } from './asset-type.ts';
import { loansApply, loanStatuses, type LoanTotals, loanTotals, NO_LOANS } from './loans.ts';
import {
  interestPaidOut,
  isBalanceKind,
  type Ledgers,
  ledgers,
  type Position,
  positions,
} from './positions.ts';
import type { PriceBook } from './prices.ts';
import { DEFAULT_RATES, type RateTables } from './rates.ts';
import { type Flow, xirr } from './xirr.ts';

export interface Filter {
  memberId?: string;
  accountId?: string;
  instrumentId?: string;
  groupId?: string;
  assetClass?: AssetClass;
}

export interface Holding {
  key: string;
  position: Position;
  instrument: Instrument;
  account: Account;
  memberId: string;
  groupIds: string[];
  status: HoldingStatus;
  /** All money figures are in INR. */
  value: number;
  /** PPF, EPF: the balance a statement shows, without interest not credited yet. */
  balance?: number;
  invested: number;
  gain: number;
  gainPct: number | null;
  priceDate?: ISODate;
  /** The value has no market price behind it (cost, projected rate). */
  estimate: boolean;
  /** Cash flows including assumed payouts, before the final value. */
  flows: Flow[];
  /** The same for XIRR, with an opening from a holdings file at its market value. */
  xirrFlows: Flow[];
  xirr: number | null;
  /** XIRR involves an opening balance from a holdings snapshot. */
  xirrEstimate: boolean;
  /** XIRR is the one the holdings file of this date gives, not worked out here. */
  xirrAsOf?: ISODate;
  weight: number;
}

export interface Summary {
  date: ISODate;
  /** Investments plus what you're owed, less what you owe. */
  netWorth: number;
  /** What the holdings are worth. Invested, gain and XIRR are about these alone. */
  investments: number;
  loans: LoanTotals;
  /** Cost of what is held now. */
  invested: number;
  /** Money in less money out, over all time. */
  netInvested: number;
  totalGain: number;
  xirr: number | null;
  xirrEstimate: boolean;
  absoluteReturn: number | null;
  firstFlow?: ISODate;
  /** Holdings still held (open or matured); closed ones only count in the totals. */
  holdings: Holding[];
  allocation: {
    assetClass: Partial<Record<AssetClass, number>>;
    member: Record<string, number>;
    group: Record<string, number>;
  };
}

export interface EngineOptions {
  rates?: RateTables;
  /** Skip per-holding XIRR, for history. */
  skipXirr?: boolean;
  /** Reuse across calls on the same state. */
  cache?: EngineCache;
}

export interface EngineCache {
  ledgers: Ledgers;
  snapshots: Map<string, Snapshot[]>;
  groups: Group[];
}

export function engineCache(state: State): EngineCache {
  const snapshots = new Map<string, Snapshot[]>();

  for (const s of all(state, 'snapshot')) {
    const key = `${s.accountId}|${s.instrumentId}`;

    (snapshots.get(key) ?? snapshots.set(key, []).get(key)!).push(s);
  }

  for (const list of snapshots.values()) {
    list.sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  }

  return { ledgers: ledgers(state), snapshots, groups: all(state, 'group') };
}

export function assetContext(
  book: PriceBook,
  date: ISODate,
  rates: RateTables,
  cache: EngineCache,
): AssetContext {
  return { date, prices: book, rates, snapshots: (key) => cache.snapshots.get(key) ?? [] };
}

function inGroup(g: Group, accountId: string, instrumentId: string): boolean {
  return g.holdings.some(
    (h) => h.instrumentId === instrumentId && (!h.accountId || h.accountId === accountId),
  );
}

function matches(h: Holding, filter: Filter | undefined): boolean {
  if (!filter) {
    return true;
  }

  if (filter.memberId && h.memberId !== filter.memberId) {
    return false;
  }

  if (filter.accountId && h.account.id !== filter.accountId) {
    return false;
  }

  if (filter.instrumentId && h.instrument.id !== filter.instrumentId) {
    return false;
  }

  if (filter.groupId && !h.groupIds.includes(filter.groupId)) {
    return false;
  }

  if (filter.assetClass && h.instrument.assetClass !== filter.assetClass) {
    return false;
  }

  return true;
}

/**
 * The XIRR the latest holdings file on or before date gives (Groww's, for funds), while nothing
 * is recorded after that file. The file knows when you bought, which its lines don't say.
 */
function fileXirr(snapshots: Snapshot[] | undefined, p: Position, date: ISODate) {
  const latest = snapshots?.findLast((s) => s.asOf <= date);
  const last = p.entries.at(-1)?.date;

  return latest?.xirr !== undefined && last !== undefined && last <= latest.asOf
    ? { rate: latest.xirr, asOf: latest.asOf }
    : undefined;
}

/** Every holding on a date, including closed ones. */
export function evaluate(
  state: State,
  book: PriceBook,
  date: ISODate,
  options: EngineOptions = {},
): Holding[] {
  const rates = options.rates ?? DEFAULT_RATES;
  const cache = options.cache ?? engineCache(state);
  const ctx = assetContext(book, date, rates, cache);
  const out: Holding[] = [];

  for (const p of positions(state, date, book, cache.ledgers)) {
    const instrument = get(state, 'instrument', p.instrumentId)!;
    const account = get(state, 'account', p.accountId)!;
    const type = assetTypeFor(instrument.kind);
    const v = type.value(p, instrument, ctx);
    const fx = (d: ISODate) => book.fx(instrument.currency, d)?.rate ?? 1;
    const value = v.value * fx(date);
    let invested: number;

    if (instrument.kind === 'cash') {
      invested = value;
    } else if (isBalanceKind(instrument.kind)) {
      invested = type.invested(p, instrument) * fx(date);
    } else {
      invested = p.lots.reduce((sum, lot) => sum + lot.costInr, 0);
    }

    const assumed: Flow[] =
      interestPaidOut(instrument) && !p.hasInterest && type.projected
        ? type
            .projected(p, instrument, '0000-01-01', date, ctx)
            .filter((f) => f.kind === 'payout' || f.kind === 'coupon')
            .map((f) => ({ date: f.date, amount: f.amount * fx(f.date) }))
        : [];
    const flows = [...p.flows, ...assumed];
    const xirrFlows = [...p.xirrFlows, ...assumed];
    const withValue = value > 0 ? [...xirrFlows, { date, amount: value }] : xirrFlows;
    // Annualising a return over less than a year exaggerates it, so, as SEBI's rules for fund
    // returns do, XIRR waits until the holding is a year old; gainPct covers it until then.
    const since = flows.reduce((min, f) => (f.date < min ? f.date : min), date);
    const yearOld = daysBetween(since, date) >= 365;
    const fromFile = options.skipXirr ? undefined : fileXirr(cache.snapshots.get(p.key), p, date);
    const gain = value - invested;

    out.push({
      key: p.key,
      position: p,
      instrument,
      account,
      memberId: account.memberId,
      groupIds: cache.groups
        .filter((g) => inGroup(g, p.accountId, p.instrumentId))
        .map((g) => g.id),
      status: v.status,
      value,
      ...(v.balance !== undefined ? { balance: v.balance * fx(date) } : {}),
      invested,
      gain,
      gainPct: invested > 0 ? gain / invested : null,
      ...(v.priceDate ? { priceDate: v.priceDate } : {}),
      estimate:
        v.estimate || (instrument.currency !== 'INR' && !book.fx(instrument.currency, date)),
      flows,
      xirrFlows,
      xirr: fromFile ? fromFile.rate : options.skipXirr || !yearOld ? null : xirr(withValue),
      xirrEstimate: p.estimate && !fromFile,
      ...(fromFile ? { xirrAsOf: fromFile.asOf } : {}),
      weight: 0,
    });
  }

  return out;
}

function totals(holdings: Holding[], date: ISODate) {
  const flows = holdings.flatMap((h) => h.flows);
  const xirrFlows = holdings.flatMap((h) => h.xirrFlows);
  const value = holdings.reduce((sum, h) => sum + h.value, 0);
  // 0 - x, not -x, so no flows give 0 rather than -0.
  const netInvested = 0 - flows.reduce((sum, f) => sum + f.amount, 0);
  const firstFlow = flows.reduce<ISODate | undefined>(
    (min, f) => (!min || f.date < min ? f.date : min),
    undefined,
  );

  return {
    value,
    netInvested,
    firstFlow,
    xirr: xirr(value > 0 ? [...xirrFlows, { date, amount: value }] : xirrFlows),
  };
}

export function summary(
  state: State,
  book: PriceBook,
  date: ISODate,
  filter?: Filter,
  options: EngineOptions = {},
): Summary {
  const all = evaluate(state, book, date, options).filter((h) => matches(h, filter));
  const { value: investments, netInvested, firstFlow, xirr: rate } = totals(all, date);
  const loans = loansApply(filter) ? loanTotals(loanStatuses(state, date, filter)) : NO_LOANS;
  const held = all.filter((h) => h.status !== 'closed');
  const allocation: Summary['allocation'] = { assetClass: {}, member: {}, group: {} };

  for (const h of held) {
    h.weight = investments > 0 ? h.value / investments : 0;
    const cls = h.instrument.assetClass;

    allocation.assetClass[cls] = (allocation.assetClass[cls] ?? 0) + h.value;
    allocation.member[h.memberId] = (allocation.member[h.memberId] ?? 0) + h.value;

    for (const g of h.groupIds.length ? h.groupIds : ['']) {
      allocation.group[g] = (allocation.group[g] ?? 0) + h.value;
    }
  }

  return {
    date,
    netWorth: investments + loans.owedToYou - loans.youOwe,
    investments,
    loans,
    invested: held.reduce((sum, h) => sum + h.invested, 0),
    netInvested,
    totalGain: investments - netInvested,
    xirr: rate,
    // The total is worked out from the flows, so it is an estimate whenever a file opened one.
    xirrEstimate: all.some((h) => h.position.estimate),
    absoluteReturn: netInvested > 0 ? (investments - netInvested) / netInvested : null,
    ...(firstFlow ? { firstFlow } : {}),
    holdings: held.sort((a, b) => b.value - a.value),
    allocation,
  };
}

export interface HistoryPoint {
  date: ISODate;
  value: number;
  netInvested: number;
  assetClass: Partial<Record<AssetClass, number>>;
  /** Some holding had no price yet and was counted at cost. */
  costOnly: boolean;
}

export function historyDates(from: ISODate, to: ISODate, step: 'day' | 'month'): ISODate[] {
  const dates: ISODate[] = [];

  if (step === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      dates.push(d);
    }

    return dates;
  }

  for (let d = endOfMonth(from); d < to; d = endOfMonth(addDays(d, 1))) {
    dates.push(d);
  }

  dates.push(to);

  return dates;
}

/** Value over time. Each day uses the latest price known by then; before any price, cost. */
export function history(
  state: State,
  book: PriceBook,
  from: ISODate,
  to: ISODate,
  options: EngineOptions & { step?: 'day' | 'month'; filter?: Filter } = {},
): HistoryPoint[] {
  const cache = options.cache ?? engineCache(state);
  const step = options.step ?? (daysBetween(from, to) > 400 ? 'month' : 'day');

  return historyDates(from, minDate(to, '9999-12-31'), step).map((date) => {
    const holdings = evaluate(state, book, date, { ...options, cache, skipXirr: true }).filter(
      (h) => matches(h, options.filter),
    );
    const assetClass: HistoryPoint['assetClass'] = {};

    for (const h of holdings) {
      assetClass[h.instrument.assetClass] = (assetClass[h.instrument.assetClass] ?? 0) + h.value;
    }

    const { value, netInvested } = totals(holdings, date);
    const costOnly = holdings.some(
      (h) => h.status === 'open' && h.estimate && !h.priceDate && !isBalanceKind(h.instrument.kind),
    );

    return { date, value, netInvested, assetClass, costOnly };
  });
}
