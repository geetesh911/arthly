// SPDX-License-Identifier: AGPL-3.0-only
// Helpers for the hand-entry forms.
import { page } from '$app/state';
import {
  type Account,
  accountId,
  defaultAssetClass,
  type Instrument,
  type InstrumentKind,
  randomId,
  roundAmount,
} from '@pv/core';

import { api, list } from './api.ts';

/** The account for a member at an institution, created if it isn't there yet. */
export async function ensureAccount(
  a: Omit<Account, 'id' | 'currency'> & { currency?: Account['currency'] },
): Promise<string> {
  const id = accountId(a);
  const existing = (await list('account')).find((x) => x.id === id);

  if (!existing) {
    await api().save('account', { currency: 'INR', ...a, id });
  }

  return id;
}

export async function newInstrument(
  i: Omit<Instrument, 'id' | 'assetClass' | 'currency' | 'ids'> & Partial<Instrument>,
): Promise<string> {
  const value: Instrument = {
    id: randomId('ins'),
    currency: 'INR',
    ids: {},
    assetClass: i.assetClass ?? defaultAssetClass(i.kind, i.name),
    ...i,
  } as Instrument;

  await api().save('instrument', value);

  return value.id;
}

export const money = (text: string | number) =>
  roundAmount(Number(String(text).replace(/[,₹\s]/g, '')));

export const todayIso = () => {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const BALANCE_KINDS: readonly InstrumentKind[] = ['cash', 'ppf', 'epf', 'eps'];

/**
 * Whether a new balance sets a holding's value, so its page can offer to update it: always for
 * bank cash, but for PPF and EPF only until deposits or interest are recorded, which then set it.
 */
export const updatesByBalance = (kind: InstrumentKind, recorded: boolean) =>
  kind === 'cash' || (!recorded && BALANCE_KINDS.includes(kind));

/** A `?name=value` from the address, before or after the hash. */
export const addressParam = (name: string) =>
  new URLSearchParams(page.url.search).get(name) ??
  new URLSearchParams(location.hash.split('?')[1] ?? '').get(name);

/** The holding a form was opened for, from `?ref=accountId|instrumentId` in the address. */
export function holdingRef(): [accountId: string, instrumentId: string] | null {
  const ref = addressParam('ref');

  return ref?.includes('|') ? (ref.split('|') as [string, string]) : null;
}
