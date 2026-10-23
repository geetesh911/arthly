// SPDX-License-Identifier: AGPL-3.0-only
// Helpers for the hand-entry forms.
import {
  accountId,
  defaultAssetClass,
  randomId,
  roundAmount,
  type Account,
  type Instrument,
} from '@pv/core';
import { api, list } from './api.ts';

/** The account for a member at an institution, created if it isn't there yet. */
export async function ensureAccount(
  a: Omit<Account, 'id' | 'currency'> & { currency?: Account['currency'] },
): Promise<string> {
  const id = accountId(a);
  const existing = (await list('account')).find((x) => x.id === id);
  if (!existing) await api().save('account', { currency: 'INR', ...a, id });
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
