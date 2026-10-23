// SPDX-License-Identifier: AGPL-3.0-only
// Things worth a look: stale prices or files, mismatches with holdings files, duplicates,
// what's due soon, overdue loans, PPF limits and sync conflicts. Each can be dismissed by key.
import { parseHlc } from '../log/hlc.ts';
import { all, get, type State } from '../log/replay.ts';
import type { Transaction } from '../model/types.ts';
import {
  daysBetween,
  fromMs,
  fyEnd,
  fyOf,
  fyStart,
  type ISODate,
  makeDate,
} from '../util/dates.ts';
import { near, valueTolerance } from '../util/numbers.ts';

import { loanStatuses } from './loans.ts';
import { engineCache, type EngineOptions, evaluate } from './portfolio.ts';
import { isBalanceKind, positions, unitsOn } from './positions.ts';
import type { PriceBook } from './prices.ts';
import { upcoming } from './upcoming.ts';

export type CheckType =
  | 'price.stale'
  | 'file.stale'
  | 'balance.stale'
  | 'backup.none'
  | 'recon.units'
  | 'recon.total'
  | 'recon.missing'
  | 'recon.unmatched'
  | 'dup.txn'
  | 'soon.maturity'
  | 'soon.payout'
  | 'ppf.minimum'
  | 'ppf.limit'
  | 'loan.overdue'
  | 'sync.conflict';

export interface Check {
  /** Unique and stable, so it can be dismissed: `<type>:<detail>`. */
  key: string;
  type: CheckType;
  severity: 'warn' | 'info';
  message: string;
  accountId?: string;
  instrumentId?: string;
  /** What the fix button does. */
  fix?: {
    kind:
      | 'record-sell'
      | 'record-maturity'
      | 'import-file'
      | 'add-price'
      | 'backup'
      | 'resolve-conflict'
      | 'open-loan';
    ref?: string;
  };
}

export interface CheckSettings {
  priceStaleDays: number;
  fileStaleDays: number;
  balanceStaleDays: number;
  backupDays: number;
  soonDays: number;
  /** Importers whose files are full holdings lists. */
  holdingsImporters: string[];
}

export const DEFAULT_CHECK_SETTINGS: CheckSettings = {
  priceStaleDays: 4,
  fileStaleDays: 35,
  balanceStaleDays: 180,
  backupDays: 30,
  soonDays: 30,
  holdingsImporters: ['groww-mf-holdings', 'groww-stock-holdings'],
};

/** Device facts that aren't in the log. */
export interface DeviceFacts {
  lastSync?: ISODate;
  lastBackup?: ISODate;
  /** The browser agreed to keep data permanently. */
  persisted?: boolean;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function batchDate(b: { asOf?: string; hlc: string }): ISODate {
  return b.asOf ?? fromMs(parseHlc(b.hlc).ms);
}

export function checks(
  state: State,
  book: PriceBook,
  today: ISODate,
  facts: DeviceFacts = {},
  settings: Partial<CheckSettings> = {},
  options: EngineOptions = {},
): Check[] {
  const s = { ...DEFAULT_CHECK_SETTINGS, ...settings };
  const cache = options.cache ?? engineCache(state);
  const out: Check[] = [];
  const name = (instrumentId: string) =>
    get(state, 'instrument', instrumentId)?.name ?? 'A holding';
  const holdings = evaluate(state, book, today, { ...options, cache, skipXirr: true });
  const open = holdings.filter((h) => h.status !== 'closed');
  const loans = loanStatuses(state, today);

  // price.stale
  let needsFx = false;

  for (const h of open) {
    const kind = h.instrument.kind;

    if (isBalanceKind(kind) || kind === 'cash') {
      continue;
    }

    if (h.instrument.currency !== 'INR') {
      needsFx = true;
    }

    if (kind === 'bond' || kind === 'sgb') {
      if (!h.priceDate) {
        continue;
      }
    }

    const age = h.priceDate ? daysBetween(h.priceDate, today) : Infinity;

    if (age > s.priceStaleDays) {
      out.push({
        key: `price.stale:${h.instrument.id}`,
        type: 'price.stale',
        severity: 'warn',
        message: h.priceDate
          ? `${h.instrument.name}: the latest price is from ${h.priceDate}`
          : `${h.instrument.name} has no price yet, so it's counted at cost`,
        instrumentId: h.instrument.id,
        fix: { kind: 'add-price', ref: h.instrument.id },
      });
    }
  }

  if (needsFx) {
    const fx = book.fx('USD', today);

    if (!fx?.date || daysBetween(fx.date, today) > s.priceStaleDays) {
      out.push({
        key: 'price.stale:fx:USDINR',
        type: 'price.stale',
        severity: 'warn',
        message: fx?.date ? `The USD→INR rate is from ${fx.date}` : 'There is no USD→INR rate yet',
      });
    }
  }

  // file.stale and recon.missing, per member and holdings importer
  const latest = new Map<string, ReturnType<typeof state.batches.get> & object>();

  for (const b of state.batches.values()) {
    if (b.reverted || !b.memberId || !s.holdingsImporters.includes(b.importer.id)) {
      continue;
    }

    const key = `${b.memberId}|${b.importer.id}`;
    const current = latest.get(key);

    if (
      !current ||
      batchDate(b) > batchDate(current) ||
      (batchDate(b) === batchDate(current) && b.hlc > current.hlc)
    ) {
      latest.set(key, b);
    }
  }

  for (const [key, b] of latest) {
    const [memberId, importer] = key.split('|') as [string, string];
    const member = get(state, 'member', memberId)?.name ?? 'Someone';
    const age = daysBetween(batchDate(b), today);

    if (age > s.fileStaleDays) {
      out.push({
        key: `file.stale:${key}`,
        type: 'file.stale',
        severity: 'warn',
        message: `${member}'s latest ${importer} file is ${age} days old`,
        fix: { kind: 'import-file', ref: importer },
      });
    }

    const inFile = new Set(
      b.keys
        .filter((k) => k.startsWith('snapshot:'))
        .map((k) => get(state, 'snapshot', k.slice('snapshot:'.length)))
        .filter((x) => x !== undefined)
        .map((x) => `${x.accountId}|${x.instrumentId}`),
    );

    for (const h of open) {
      if (h.memberId !== memberId || h.position.units <= 1e-9 || inFile.has(h.key)) {
        continue;
      }

      const snaps = cache.snapshots.get(h.key) ?? [];
      const first = snaps[0];
      const firstBatch =
        first?.source.kind === 'import' ? state.batches.get(first.source.batchId) : undefined;

      if (firstBatch?.importer.id !== importer) {
        continue;
      }

      if ((snaps.at(-1)?.asOf ?? '') >= batchDate(b)) {
        continue;
      }

      out.push({
        key: `recon.missing:${h.key}:${b.batchId}`,
        type: 'recon.missing',
        severity: 'warn',
        message: `${h.instrument.name} isn't in ${member}'s latest ${importer} file. Was it sold?`,
        accountId: h.account.id,
        instrumentId: h.instrument.id,
        fix: { kind: 'record-sell', ref: h.key },
      });
    }
  }

  // recon.total and recon.unmatched, from the latest batch per importer and member
  for (const b of state.batches.values()) {
    if (b.reverted) {
      continue;
    }

    const newer = [...state.batches.values()].some(
      (o) =>
        !o.reverted &&
        o.importer.id === b.importer.id &&
        o.memberId === b.memberId &&
        o.hlc > b.hlc,
    );

    if (newer) {
      continue;
    }

    for (const [n, f] of b.findings.entries()) {
      out.push({
        key: `${f.key}:${b.batchId}:${n}`,
        type: f.key,
        severity: 'warn',
        message: f.message,
      });
    }
  }

  // balance.stale
  for (const h of open) {
    if (h.instrument.kind !== 'ppf' && h.instrument.kind !== 'epf') {
      continue;
    }

    const lastEntry = h.position.entries.at(-1)?.date;
    const lastSnap = cache.snapshots.get(h.key)?.at(-1)?.asOf;
    const last = [lastEntry, lastSnap]
      .filter((d) => d !== undefined)
      .sort()
      .at(-1);

    if (last && daysBetween(last, today) > s.balanceStaleDays) {
      out.push({
        key: `balance.stale:${h.key}`,
        type: 'balance.stale',
        severity: 'info',
        message: `${h.instrument.name} hasn't been updated since ${last}. Import the latest passbook or statement.`,
        accountId: h.account.id,
        instrumentId: h.instrument.id,
        fix: { kind: 'import-file' },
      });
    }
  }

  // backup.none
  const lastSafe = [facts.lastSync, facts.lastBackup]
    .filter((d) => d !== undefined)
    .sort()
    .at(-1);

  if (
    (holdings.length > 0 || loans.length > 0) &&
    (!lastSafe || daysBetween(lastSafe, today) > s.backupDays)
  ) {
    out.push({
      key: 'backup.none',
      type: 'backup.none',
      severity: facts.persisted === false ? 'warn' : 'info',
      message: lastSafe
        ? `The last backup or sync was on ${lastSafe}`
        : 'Your data is only on this device. Make a backup file or turn on sync.',
      fix: { kind: 'backup' },
    });
  }

  // recon.units: ledger against the latest snapshot, where transactions exist
  for (const p of positions(state, today, book, cache.ledgers)) {
    const snap = cache.snapshots
      .get(p.key)
      ?.filter((x) => x.asOf <= today)
      .at(-1);

    if (!snap || p.entries.every((e) => e.synthetic)) {
      continue;
    }

    const instrument = get(state, 'instrument', p.instrumentId);

    if (!instrument) {
      continue;
    }

    if (isBalanceKind(instrument.kind)) {
      const h = evaluate(state, book, snap.asOf, { ...options, cache, skipXirr: true }).find(
        (x) => x.key === p.key,
      );
      const expected = snap.value ?? snap.units;
      const shown = h && (h.balance ?? h.value);

      if (shown !== undefined && !near(shown, expected, valueTolerance(expected))) {
        out.push({
          key: `recon.units:${p.key}:${snap.asOf}`,
          type: 'recon.units',
          severity: 'warn',
          message: `${instrument.name}: the ledger gives ${inr(shown)} on ${snap.asOf}, the statement says ${inr(expected)}`,
          accountId: p.accountId,
          instrumentId: p.instrumentId,
        });
      }

      continue;
    }

    const units = unitsOn(p.entries, snap.asOf);

    if (!near(units, snap.units, 0.001)) {
      out.push({
        key: `recon.units:${p.key}:${snap.asOf}`,
        type: 'recon.units',
        severity: 'warn',
        message: `${instrument.name}: your transactions give ${units} units on ${snap.asOf}, the holdings file says ${snap.units}`,
        accountId: p.accountId,
        instrumentId: p.instrumentId,
      });
    }
  }

  // dup.txn
  const groups = new Map<string, Transaction[]>();

  for (const t of all(state, 'transaction')) {
    const key = `${t.accountId}|${t.instrumentId}|${t.date}|${t.type}`;

    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const sourceOf = (t: Transaction) => (t.source.kind === 'import' ? t.source.batchId : 'manual');

  for (const list of groups.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const x = list[a]!;
        const y = list[b]!;

        if (sourceOf(x) === sourceOf(y)) {
          continue;
        }

        const unitsClose =
          x.units === undefined || y.units === undefined
            ? x.units === y.units
            : Math.abs(x.units - y.units) <= 0.001 * Math.max(Math.abs(x.units), Math.abs(y.units));

        if (!unitsClose || !near(x.amount, y.amount, 1)) {
          continue;
        }

        const [first, second] = [x.id, y.id].sort();

        out.push({
          key: `dup.txn:${first}:${second}`,
          type: 'dup.txn',
          severity: 'warn',
          message: `${name(x.instrumentId)}: two ${x.type} entries on ${x.date} for ${inr(x.amount)} look like the same one`,
          accountId: x.accountId,
          instrumentId: x.instrumentId,
        });
      }
    }
  }

  // soon.maturity and soon.payout
  for (const h of open) {
    if (h.status === 'matured') {
      out.push({
        key: `soon.maturity:${h.key}`,
        type: 'soon.maturity',
        severity: 'warn',
        message: `${h.instrument.name} has matured. Record the payout or the renewal.`,
        accountId: h.account.id,
        instrumentId: h.instrument.id,
        fix: { kind: 'record-maturity', ref: h.key },
      });
    }
  }

  for (const u of upcoming(state, book, today, s.soonDays, { ...options, cache })) {
    if (u.kind === 'credit' || u.kind === 'ppf-deadline') {
      continue;
    }

    const type = u.kind === 'maturity' ? 'soon.maturity' : 'soon.payout';

    out.push({
      key: `${type}:${u.accountId}|${u.instrumentId}:${u.date}`,
      type,
      severity: 'info',
      message: `${name(u.instrumentId)}: ${u.kind} of about ${inr(u.amount ?? 0)} on ${u.date}`,
      accountId: u.accountId,
      instrumentId: u.instrumentId,
    });
  }

  // ppf.minimum and ppf.limit
  const fy = fyOf(today);
  const perMember = new Map<string, number>();

  for (const h of open) {
    if (h.instrument.kind !== 'ppf') {
      continue;
    }

    const deposited = h.position.entries
      .filter(
        (e) =>
          e.type === 'contribution' && !e.synthetic && e.date >= fyStart(fy) && e.date <= fyEnd(fy),
      )
      .reduce((sum, e) => sum + e.amount, 0);

    perMember.set(h.memberId, (perMember.get(h.memberId) ?? 0) + deposited);

    if (today >= makeDate(fy + 1, 3, 1) && deposited < 500) {
      out.push({
        key: `ppf.minimum:${h.key}:${fy}`,
        type: 'ppf.minimum',
        severity: 'warn',
        message: `${h.instrument.name}: deposit at least ₹500 by 31 March to keep the account active (${inr(deposited)} so far)`,
        accountId: h.account.id,
        instrumentId: h.instrument.id,
      });
    }
  }

  for (const [memberId, deposited] of perMember) {
    if (deposited > 150_000) {
      out.push({
        key: `ppf.limit:${memberId}:${fy}`,
        type: 'ppf.limit',
        severity: 'warn',
        message: `${get(state, 'member', memberId)?.name ?? 'Someone'} has deposited ${inr(deposited)} in PPF this year, over the ₹1,50,000 limit`,
      });
    }
  }

  // loan.overdue
  for (const { loan, balance, overdue } of loans) {
    if (!overdue) {
      continue;
    }

    out.push({
      key: `loan.overdue:${loan.id}:${loan.due}`,
      type: 'loan.overdue',
      severity: 'warn',
      message:
        loan.direction === 'lent'
          ? `${loan.party} was due to pay back ${inr(balance)} by ${loan.due}`
          : `You were due to pay ${loan.party} back ${inr(balance)} by ${loan.due}`,
      fix: { kind: 'open-loan', ref: loan.id },
    });
  }

  // sync.conflict
  for (const c of state.conflicts.values()) {
    out.push({
      key: `sync.conflict:${c.entity}:${c.id}:${c.winner.hlc}`,
      type: 'sync.conflict',
      severity: 'warn',
      message: `A ${c.entity === 'loanEntry' ? 'loan entry' : c.entity} was changed on two devices. The later change was kept.`,
      fix: { kind: 'resolve-conflict', ref: `${c.entity}:${c.id}` },
    });
  }

  const dismissed = new Set(all(state, 'dismissal').map((d) => d.checkKey));

  return out.filter((c) => !dismissed.has(c.key));
}
