// SPDX-License-Identifier: AGPL-3.0-only
// Holdings per account × instrument, built from transactions, with holdings snapshots as the
// fallback where no transactions exist yet.
import { all, get, type State } from '../log/replay.ts';
import type {
  Currency,
  Instrument,
  InstrumentKind,
  Snapshot,
  Source,
  Transaction,
  TransactionType,
} from '../model/types.ts';
import type { ISODate } from '../util/dates.ts';
import type { PriceBook } from './prices.ts';
import type { Flow } from './xirr.ts';

export interface Lot {
  date: ISODate;
  units: number;
  /** In the instrument's currency. */
  cost: number;
  costInr: number;
}

/** One line of a holding's ledger: a transaction, or one worked out from holdings snapshots. */
export interface Entry {
  id: string;
  date: ISODate;
  type: TransactionType;
  units?: number;
  price?: number;
  amount: number;
  currency: Currency;
  fx?: number;
  meta?: Record<string, string>;
  source?: Source;
  /** Worked out from snapshots rather than recorded. */
  synthetic: boolean;
  /**
   * For an opening worked out from a holdings file: its market value that day. A holdings file
   * gives what was paid but not when, so XIRR counts this value as the money put in instead.
   */
  marketValue?: number;
}

export interface Position {
  key: string;
  accountId: string;
  instrumentId: string;
  entries: Entry[];
  units: number;
  lots: Lot[];
  /** Cost of the open lots, in the instrument's currency. */
  cost: number;
  /** Money put in less money taken out, for balance-type holdings (FD, PPF, EPF, EPS). */
  principal: number;
  /** Interest credited into the holding rather than paid out. */
  credited: number;
  realised: number;
  /** External cash flows in INR: money in negative. */
  flows: Flow[];
  /** The flows XIRR uses: the same, but an opening counts at its market value (Entry.marketValue). */
  xirrFlows: Flow[];
  /** True when real interest transactions exist, so assumed payouts are not added. */
  hasInterest: boolean;
  /** The date of a maturity transaction, once recorded. */
  matured?: ISODate;
  /** Built partly from holdings snapshots, so XIRR is an estimate. */
  estimate: boolean;
  /** Units sold beyond what was held. */
  oversold: number;
}

const BALANCE_KINDS: ReadonlySet<InstrumentKind> = new Set(['fd', 'ppf', 'epf', 'eps']);
const EPS = 1e-9;

export const positionKey = (accountId: string, instrumentId: string) =>
  `${accountId}|${instrumentId}`;

/** True for holdings tracked by balance (FD, PPF, EPF, EPS) rather than units. */
export const isBalanceKind = (kind: InstrumentKind) => BALANCE_KINDS.has(kind);

/** Whether interest leaves the holding (payout FD, coupon) or is credited into it. */
export function interestPaidOut(i: Instrument): boolean {
  switch (i.kind) {
    case 'ppf':
    case 'epf':
    case 'eps':
    case 'cash':
      return false;
    case 'fd':
      return !!i.terms && 'payout' in i.terms && i.terms.payout !== 'cumulative';
    default:
      return true;
  }
}

function snapshotPrice(s: Snapshot): number | undefined {
  return s.price ?? (s.value !== undefined && s.units > 0 ? s.value / s.units : undefined);
}

/**
 * Entries from the snapshots dated before the first transaction: the first becomes an opening
 * balance and each later one adds the change since the previous one.
 */
function snapshotEntries(
  snapshots: Snapshot[],
  instrument: Instrument,
  firstBought: ISODate | undefined,
): Entry[] {
  const entries: Entry[] = [];
  const balance = isBalanceKind(instrument.kind);
  let prevUnits = 0;
  let prevPrincipal = 0;
  for (const [n, s] of snapshots.entries()) {
    const base = { currency: instrument.currency, synthetic: true, source: s.source } as const;
    const date = n === 0 && firstBought && firstBought < s.asOf ? firstBought : s.asOf;
    // With a first-bought date, the cost was paid then; without one, XIRR starts from the file.
    const fromFile = date === s.asOf;
    if (balance) {
      const total = s.value ?? s.units;
      const principal = s.invested ?? total;
      if (n === 0) {
        entries.push({
          ...base,
          id: `syn:${s.id}`,
          date,
          type: 'opening',
          amount: principal,
          ...(fromFile ? { marketValue: total } : {}),
        });
        if (total > principal + EPS) {
          entries.push({
            ...base,
            id: `syn:${s.id}:i`,
            date,
            type: 'interest',
            amount: total - principal,
          });
        }
      } else if (Math.abs(principal - prevPrincipal) > EPS) {
        const type = principal > prevPrincipal ? 'contribution' : 'withdrawal';
        entries.push({
          ...base,
          id: `syn:${s.id}`,
          date,
          type,
          amount: Math.abs(principal - prevPrincipal),
        });
      }
      prevPrincipal = principal;
      continue;
    }
    const delta = s.units - prevUnits;
    if (n === 0) {
      const price = snapshotPrice(s);
      const amount = s.invested ?? s.units * (price ?? 0);
      entries.push({
        ...base,
        id: `syn:${s.id}`,
        date,
        type: 'opening',
        units: s.units,
        amount,
        ...(fromFile && price !== undefined ? { marketValue: s.units * price } : {}),
      });
    } else if (delta > EPS) {
      const invested = s.invested !== undefined ? s.invested - prevPrincipal : undefined;
      const amount =
        invested !== undefined && invested > 0 ? invested : delta * (snapshotPrice(s) ?? 0);
      entries.push({ ...base, id: `syn:${s.id}`, date, type: 'buy', units: delta, amount });
    } else if (delta < -EPS) {
      const amount = -delta * (snapshotPrice(s) ?? 0);
      entries.push({ ...base, id: `syn:${s.id}`, date, type: 'sell', units: -delta, amount });
    }
    prevUnits = s.units;
    prevPrincipal = s.invested ?? prevPrincipal;
  }
  return entries;
}

function fromTransaction(t: Transaction): Entry {
  const { accountId: _a, instrumentId: _i, ...rest } = t;
  return { ...rest, synthetic: false };
}

/** Each holding's full ledger, sorted by date, with no date cut-off. */
export function ledgers(
  state: State,
): Map<string, { accountId: string; instrumentId: string; entries: Entry[]; estimate: boolean }> {
  const txns = new Map<string, Transaction[]>();
  const snaps = new Map<string, Snapshot[]>();
  for (const t of all(state, 'transaction')) {
    const key = positionKey(t.accountId, t.instrumentId);
    (txns.get(key) ?? txns.set(key, []).get(key)!).push(t);
  }
  for (const s of all(state, 'snapshot')) {
    const key = positionKey(s.accountId, s.instrumentId);
    (snaps.get(key) ?? snaps.set(key, []).get(key)!).push(s);
  }
  const out = new Map<
    string,
    { accountId: string; instrumentId: string; entries: Entry[]; estimate: boolean }
  >();
  for (const key of new Set([...txns.keys(), ...snaps.keys()])) {
    const [accountId, instrumentId] = key.split('|') as [string, string];
    const instrument = get(state, 'instrument', instrumentId);
    if (!instrument || !get(state, 'account', accountId)) continue;
    const real = (txns.get(key) ?? []).map(fromTransaction);
    const first = real.reduce<ISODate | undefined>(
      (min, e) => (!min || e.date < min ? e.date : min),
      undefined,
    );
    const before = (snaps.get(key) ?? [])
      .filter((s) => !first || s.asOf < first)
      .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
    const firstBought = get(state, 'setting', `firstBought:${key}`)?.value as ISODate | undefined;
    const entries = [...snapshotEntries(before, instrument, firstBought), ...real].sort(byDate);
    out.set(key, { accountId, instrumentId, entries, estimate: before.length > 0 });
  }
  return out;
}

const TYPE_ORDER: Record<TransactionType, number> = {
  opening: 0,
  split: 1,
  bonus: 2,
  buy: 3,
  'switch-in': 3,
  contribution: 3,
  'dividend-reinvest': 3,
  interest: 4,
  dividend: 4,
  charge: 5,
  tax: 5,
  sell: 6,
  'switch-out': 6,
  withdrawal: 6,
  maturity: 7,
};

function byDate(a: Entry, b: Entry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Removes units first-in-first-out, returning the cost taken out. */
function consume(p: Position, units: number): { cost: number; costInr: number } {
  let left = units;
  let cost = 0;
  let costInr = 0;
  while (left > EPS && p.lots.length > 0) {
    const lot = p.lots[0]!;
    if (lot.units <= left + EPS) {
      cost += lot.cost;
      costInr += lot.costInr;
      left -= lot.units;
      p.lots.shift();
    } else {
      const share = left / lot.units;
      cost += lot.cost * share;
      costInr += lot.costInr * share;
      lot.cost -= lot.cost * share;
      lot.costInr -= lot.costInr * share;
      lot.units -= left;
      left = 0;
    }
  }
  p.oversold += Math.max(0, left);
  return { cost, costInr };
}

type FxFn = (currency: Currency, date: ISODate) => number;

function apply(p: Position, e: Entry, paidOut: boolean, fx: FxFn): void {
  const rate = e.currency === 'INR' ? 1 : (e.fx ?? fx(e.currency, e.date));
  const flow = (sign: 1 | -1, forXirr = e.amount) => {
    p.flows.push({ date: e.date, amount: sign * e.amount * rate });
    p.xirrFlows.push({ date: e.date, amount: sign * forXirr * rate });
  };
  const addLot = (units: number, cost: number) => {
    p.lots.push({ date: e.date, units, cost, costInr: cost * rate });
    p.units += units;
    p.cost += cost;
  };
  switch (e.type) {
    case 'opening':
    case 'buy':
    case 'switch-in':
    case 'contribution':
      if (e.units !== undefined && e.units > 0) addLot(e.units, e.amount);
      p.principal += e.amount;
      flow(-1, e.marketValue ?? e.amount);
      break;
    case 'dividend-reinvest':
      if (e.units) addLot(e.units, e.amount);
      break;
    case 'bonus':
      if (e.units) addLot(e.units, 0);
      break;
    case 'split':
      if (e.units && p.units > EPS) {
        const factor = (p.units + e.units) / p.units;
        for (const lot of p.lots) lot.units *= factor;
        p.units *= factor;
      }
      break;
    case 'sell':
    case 'switch-out': {
      const units = Math.min(e.units ?? 0, p.units);
      const taken = consume(p, e.units ?? 0);
      p.units -= units;
      p.cost -= taken.cost;
      p.principal -= taken.cost;
      p.realised += e.amount - taken.cost;
      flow(1);
      break;
    }
    case 'withdrawal':
      p.principal -= e.amount;
      flow(1);
      break;
    case 'interest':
      if (!e.synthetic) p.hasInterest = true;
      if (paidOut) flow(1);
      else p.credited += e.amount;
      break;
    case 'dividend':
      flow(1);
      break;
    case 'charge':
      p.principal += e.amount;
      flow(-1);
      break;
    case 'tax':
      if (paidOut) flow(-1);
      else p.credited -= e.amount;
      break;
    case 'maturity':
      p.matured = e.date;
      p.units = 0;
      p.lots = [];
      p.cost = 0;
      flow(1);
      break;
  }
}

/** Units held at the end of a date, from a holding's entries. */
export function unitsOn(entries: readonly Entry[], date: ISODate): number {
  let units = 0;
  for (const e of entries) {
    if (e.date > date) break;
    switch (e.type) {
      case 'opening':
      case 'buy':
      case 'switch-in':
      case 'bonus':
      case 'dividend-reinvest':
      case 'split':
        units += e.units ?? 0;
        break;
      case 'sell':
      case 'switch-out':
        units = Math.max(0, units - (e.units ?? 0));
        break;
      case 'maturity':
        units = 0;
        break;
    }
  }
  return units;
}

export type Ledgers = ReturnType<typeof ledgers>;

/** Every holding as of date (inclusive). Pass `cache` from `ledgers(state)` when calling repeatedly. */
export function positions(
  state: State,
  date: ISODate,
  book?: PriceBook,
  cache?: Ledgers,
): Position[] {
  const fx: FxFn = (currency, d) => book?.fx(currency, d)?.rate ?? 1;
  const out: Position[] = [];
  for (const [key, ledger] of cache ?? ledgers(state)) {
    const instrument = get(state, 'instrument', ledger.instrumentId)!;
    const paidOut = interestPaidOut(instrument);
    const p: Position = {
      key,
      accountId: ledger.accountId,
      instrumentId: ledger.instrumentId,
      entries: [],
      units: 0,
      lots: [],
      cost: 0,
      principal: 0,
      credited: 0,
      realised: 0,
      flows: [],
      xirrFlows: [],
      hasInterest: false,
      estimate: ledger.estimate,
      oversold: 0,
    };
    for (const e of ledger.entries) {
      if (e.date > date) break;
      p.entries.push(e);
      apply(p, e, paidOut, fx);
    }
    if (p.entries.length > 0) out.push(p);
  }
  return out;
}
