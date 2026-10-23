// SPDX-License-Identifier: AGPL-3.0-only
// Turning a parsed file into a preview, then into one import.apply event.
import { isBalanceKind, ledgers, unitsOn } from '../engine/positions.ts';
import type { Finding, ImportApplyData, Put } from '../log/events.ts';
import { all, get, type State } from '../log/replay.ts';
import { accountId, importedTransactionId, randomId, snapshotId } from '../model/ids.ts';
import type { Account, Snapshot, Transaction } from '../model/types.ts';
import { toHex } from '../util/bytes.ts';
import { near, roundAmount, valueTolerance } from '../util/numbers.ts';

import { type InstrumentMatch, matchInstruments } from './match.ts';
import type { AmfiScheme, ImportDraft, Importer, InputFile } from './types.ts';

export type ItemStatus = 'new' | 'changed' | 'same' | 'duplicate';

export interface PlanItem {
  put: Put;
  status: ItemStatus;
  /** Duplicates start unticked; everything else ticked. */
  include: boolean;
  /** A holdings line that disagrees with the transactions already recorded. */
  mismatch?: string;
}

export interface ImportPlan {
  importer: { id: string; version: number };
  file: { name: string; sha256: string; size: number };
  memberId: string;
  asOf?: string;
  items: PlanItem[];
  matches: InstrumentMatch[];
  totals?: {
    file: { invested?: number; value?: number };
    lines: { invested: number; value: number };
    ok: boolean;
  };
  findings: Finding[];
  warnings: string[];
}

const PENDING = '(pending)';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);

  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)));
}

/** The importer that recognises the file best, if any scores at least 0.6. */
export async function pickImporter(
  file: InputFile,
  importers: readonly Importer[],
): Promise<{ importer: Importer; score: number } | null> {
  let best: { importer: Importer; score: number } | null = null;

  for (const importer of importers) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();

    if (!importer.extensions.includes(ext)) {
      continue;
    }

    const score = await importer.detect(file).catch(() => 0);

    if (!best || score > best.score) {
      best = { importer, score };
    }
  }

  return best && best.score >= 0.6 ? best : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  const strip = (v: unknown) => {
    const { source: _s, ...rest } = v as Record<string, unknown>;

    return JSON.stringify(rest, Object.keys(rest).sort());
  };

  return strip(a) === strip(b);
}

export function planImport(
  state: State,
  draft: ImportDraft,
  options: {
    importer: { id: string; version: number };
    file: { name: string; sha256: string; size: number };
    memberId: string;
    amfi?: readonly AmfiScheme[];
    /** The user's choices on the preview: a draft ref linked to an existing instrument id. */
    links?: Record<string, string>;
    /** Draft refs whose fund-name match the user turned down. */
    rejected?: string[];
  },
): ImportPlan {
  const items: PlanItem[] = [];
  const findings: Finding[] = [];
  const source = { kind: 'import' as const, batchId: PENDING };

  const accounts = new Map<string, Account>();

  for (const a of draft.accounts) {
    const id = accountId({
      memberId: options.memberId,
      institution: a.institution,
      kind: a.kind,
      ref: a.maskedRef,
    });
    const value: Account = {
      id,
      memberId: options.memberId,
      institution: a.institution,
      kind: a.kind,
      label: a.label,
      ...(a.maskedRef ? { ref: a.maskedRef } : {}),
      currency: a.currency,
    };

    accounts.set(a.ref, get(state, 'account', id) ?? value);

    if (!get(state, 'account', id)) {
      items.push({ put: { entity: 'account', id, value }, status: 'new', include: true });
    }
  }

  const matches = matchInstruments(
    state,
    draft.instruments,
    options.amfi,
    new Set(options.rejected),
  ).map((m) => {
    const linked = options.links?.[m.ref];
    const instrument = linked ? get(state, 'instrument', linked) : undefined;

    return instrument
      ? { ...m, instrument, existing: true, how: 'existing-id' as const, confirm: false }
      : m;
  });
  const instruments = new Map(matches.map((m) => [m.ref, m.instrument]));

  for (const m of matches) {
    if (!m.existing) {
      if (!items.some((x) => x.put.id === m.instrument.id)) {
        items.push({
          put: { entity: 'instrument', id: m.instrument.id, value: m.instrument },
          status: 'new',
          include: true,
        });
      }
    }

    if (m.how === 'unmatched') {
      findings.push({
        key: 'recon.unmatched',
        message: `${m.instrument.name} isn't linked to a price source yet. Link it to a fund to get daily prices.`,
      });
    }
  }

  const known = ledgers(state);
  const existingTxns = all(state, 'transaction');
  const seen = new Map<string, number>();

  for (const t of draft.transactions) {
    const account = accounts.get(t.account);
    const instrument = instruments.get(t.instrument);

    if (!account || !instrument) {
      continue;
    }

    const base = {
      accountId: account.id,
      instrumentId: instrument.id,
      date: t.date,
      type: t.type,
      units: t.units,
      amount: t.amount,
    };
    const sig = JSON.stringify([
      base.accountId,
      base.instrumentId,
      t.date,
      t.type,
      t.units ?? null,
      roundAmount(t.amount),
    ]);
    const n = seen.get(sig) ?? 0;

    seen.set(sig, n + 1);
    const id = importedTransactionId(base, n);
    const value: Transaction = {
      id,
      accountId: account.id,
      instrumentId: instrument.id,
      date: t.date,
      type: t.type,
      ...(t.units !== undefined ? { units: t.units } : {}),
      ...(t.price !== undefined ? { price: t.price } : {}),
      amount: roundAmount(t.amount),
      currency: t.currency,
      ...(t.meta ? { meta: t.meta } : {}),
      source,
    };
    const current = get(state, 'transaction', id);

    if (current) {
      items.push({
        put: { entity: 'transaction', id, value },
        status: sameValue(current, value) ? 'same' : 'changed',
        include: !sameValue(current, value),
      });
      continue;
    }

    const duplicate = existingTxns.some(
      (x) =>
        x.accountId === value.accountId &&
        x.instrumentId === value.instrumentId &&
        x.date === value.date &&
        x.type === value.type &&
        near(x.amount, value.amount, 1) &&
        (x.units === undefined || value.units === undefined
          ? x.units === value.units
          : Math.abs(x.units - value.units) <= 0.001 * Math.max(x.units, value.units)),
    );

    items.push({
      put: { entity: 'transaction', id, value },
      status: duplicate ? 'duplicate' : 'new',
      include: !duplicate,
    });
  }

  for (const put of draft.records ?? []) {
    const current = state.tables[put.entity].get(put.id)?.value;
    const status: ItemStatus = !current
      ? 'new'
      : sameValue(current, put.value)
        ? 'same'
        : 'changed';

    items.push({ put, status, include: status !== 'same' });
  }

  let linesInvested = 0;
  let linesValue = 0;

  for (const s of draft.snapshots) {
    const account = accounts.get(s.account);
    const instrument = instruments.get(s.instrument);

    if (!account || !instrument) {
      continue;
    }

    linesInvested += s.invested ?? 0;
    linesValue += s.value ?? 0;
    const id = snapshotId({ accountId: account.id, instrumentId: instrument.id, asOf: s.asOf });
    const value: Snapshot = {
      id,
      accountId: account.id,
      instrumentId: instrument.id,
      asOf: s.asOf,
      units: s.units,
      ...(s.invested !== undefined ? { invested: s.invested } : {}),
      ...(s.value !== undefined ? { value: s.value } : {}),
      ...(s.price !== undefined ? { price: s.price } : {}),
      ...(s.xirr !== undefined ? { xirr: s.xirr } : {}),
      source,
    };
    const ledger = known.get(`${account.id}|${instrument.id}`);
    const real = ledger?.entries.filter((e) => !e.synthetic) ?? [];
    let mismatch: string | undefined;

    // PPF and EPF hold no units; the checks compare their balances once imported.
    if (!isBalanceKind(instrument.kind) && real.length > 0 && real[0]!.date <= s.asOf) {
      const units = unitsOn(ledger!.entries, s.asOf);

      if (!near(units, s.units, 0.001)) {
        mismatch = `Your transactions give ${units} units; the file says ${s.units}`;
      }
    }

    const current = get(state, 'snapshot', id);
    const status: ItemStatus = !current ? 'new' : sameValue(current, value) ? 'same' : 'changed';

    items.push({
      put: { entity: 'snapshot', id, value },
      status,
      include: status !== 'same',
      ...(mismatch ? { mismatch } : {}),
    });
  }

  let totals: ImportPlan['totals'];

  if (draft.totals && (draft.totals.invested !== undefined || draft.totals.value !== undefined)) {
    const lines = { invested: roundAmount(linesInvested), value: roundAmount(linesValue) };
    const off = (file: number | undefined, sum: number) =>
      file !== undefined && !near(file, sum, valueTolerance(file));
    const ok = !off(draft.totals.invested, lines.invested) && !off(draft.totals.value, lines.value);

    totals = { file: draft.totals, lines, ok };

    if (!ok) {
      findings.push({
        key: 'recon.total',
        message: `${options.file.name}: the file's totals don't match the sum of its lines`,
      });
    }
  }

  return {
    importer: options.importer,
    file: options.file,
    memberId: options.memberId,
    ...(draft.asOf ? { asOf: draft.asOf } : {}),
    items,
    matches,
    ...(totals ? { totals } : {}),
    findings,
    warnings: draft.warnings,
  };
}

/** True when importing would change nothing; the preview says "already up to date". */
export function upToDate(plan: ImportPlan): boolean {
  return !plan.items.some((i) => i.include && i.status !== 'same');
}

/** The event data for the ticked items, or null when there is nothing to write. */
export function applyPlan(plan: ImportPlan, batchId = randomId('bat')): ImportApplyData | null {
  if (upToDate(plan)) {
    return null;
  }

  const puts = plan.items
    .filter((i) => i.include && i.status !== 'same')
    .map((i): Put => {
      if (i.put.entity !== 'transaction' && i.put.entity !== 'snapshot') {
        return i.put;
      }

      return { ...i.put, value: { ...i.put.value, source: { kind: 'import', batchId } } } as Put;
    });

  return {
    batchId,
    importer: plan.importer,
    file: plan.file,
    memberId: plan.memberId,
    ...(plan.asOf ? { asOf: plan.asOf } : {}),
    puts,
    ...(plan.findings.length ? { findings: plan.findings } : {}),
  };
}
