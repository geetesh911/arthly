// SPDX-License-Identifier: AGPL-3.0-only
import { sha256 } from '@noble/hashes/sha2.js';

import { base32Encode } from '../util/base32.ts';
import { randomBytes, utf8 } from '../util/bytes.ts';
import { roundAmount, roundUnits } from '../util/numbers.ts';

import type { AccountKind, InstrumentIds, TransactionType } from './types.ts';

/** 26 base32 characters, about 130 bits. */
const ID_LENGTH = 26;

export function hashId(prefix: string, parts: readonly unknown[]): string {
  const digest = sha256(utf8.encode(JSON.stringify(parts)));

  return `${prefix}_${base32Encode(digest).slice(0, ID_LENGTH)}`;
}

export function randomId(prefix: string): string {
  return `${prefix}_${base32Encode(randomBytes(16)).slice(0, ID_LENGTH)}`;
}

/** 8 random base32 characters per install. */
export function newDeviceId(): string {
  return base32Encode(randomBytes(5));
}

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Keeps the last 4 characters: "1234567890" → "••••7890". */
export function mask(ref: string): string {
  const clean = ref.replace(/\s+/g, '');

  return clean.length <= 4 ? clean : `••••${clean.slice(-4)}`;
}

export function instrumentKey(ids: InstrumentIds, name: string): string {
  if (ids.isin) {
    return `isin:${ids.isin.toUpperCase()}`;
  }

  if (ids.amfi) {
    return `amfi:${ids.amfi}`;
  }

  if (ids.nse) {
    return `nse:${ids.nse.toUpperCase()}`;
  }

  if (ids.bse) {
    return `bse:${ids.bse}`;
  }

  if (ids.us) {
    return `us:${ids.us.toUpperCase()}`;
  }

  return `name:${normaliseName(name)}`;
}

export function instrumentId(ids: InstrumentIds, name: string): string {
  return hashId('ins', [instrumentKey(ids, name)]);
}

export function accountId(a: {
  memberId: string;
  institution: string;
  kind: AccountKind;
  ref?: string;
}): string {
  return hashId('acc', [a.memberId, normaliseName(a.institution), a.kind, a.ref ?? '']);
}

/** n is the position among identical rows in the same file, starting at 0. */
export function importedTransactionId(
  t: {
    accountId: string;
    instrumentId: string;
    date: string;
    type: TransactionType;
    units?: number;
    amount: number;
  },
  n: number,
): string {
  return hashId('txn', [
    t.accountId,
    t.instrumentId,
    t.date,
    t.type,
    t.units === undefined ? null : roundUnits(t.units),
    roundAmount(t.amount),
    n,
  ]);
}

export function snapshotId(s: { accountId: string; instrumentId: string; asOf: string }): string {
  return hashId('snp', [s.accountId, s.instrumentId, s.asOf]);
}

export function dismissalId(checkKey: string): string {
  return hashId('dis', [checkKey]);
}
