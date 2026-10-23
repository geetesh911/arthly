// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  accountId,
  importedTransactionId,
  instrumentId,
  instrumentKey,
  mask,
  newDeviceId,
  normaliseName,
  randomId,
  snapshotId,
} from './ids.ts';

describe('ids', () => {
  it('makes instrument IDs from the first available key', () => {
    expect(instrumentKey({ isin: 'ine123', amfi: '1' }, 'x')).toBe('isin:INE123');
    expect(instrumentKey({ amfi: '147481', nse: 'X' }, 'x')).toBe('amfi:147481');
    expect(instrumentKey({}, 'Parag Parikh  ELSS-Tax Saver')).toBe(
      'name:parag parikh elss tax saver',
    );
    expect(instrumentId({ isin: 'INE123' }, 'a')).toBe(instrumentId({ isin: 'ine123' }, 'b'));
    expect(instrumentId({ isin: 'INE123' }, 'a')).toMatch(/^ins_[a-z2-7]{26}$/);
  });

  it('gives the same account ID for the same institution however it is written', () => {
    const a = accountId({ memberId: 'm1', institution: 'Groww', kind: 'mf', ref: '••••1234' });
    const b = accountId({ memberId: 'm1', institution: 'GROWW ', kind: 'mf', ref: '••••1234' });
    expect(a).toBe(b);
    expect(
      accountId({ memberId: 'm2', institution: 'Groww', kind: 'mf', ref: '••••1234' }),
    ).not.toBe(a);
  });

  it('separates identical rows by position and rounds numbers', () => {
    const t = {
      accountId: 'acc_1',
      instrumentId: 'ins_1',
      date: '2026-01-01',
      type: 'buy' as const,
      units: 1.0000001,
      amount: 100.001,
    };
    expect(importedTransactionId(t, 0)).toBe(
      importedTransactionId({ ...t, units: 1, amount: 100 }, 0),
    );
    expect(importedTransactionId(t, 0)).not.toBe(importedTransactionId(t, 1));
  });

  it('makes snapshot IDs per account, instrument and date', () => {
    const s = { accountId: 'a', instrumentId: 'i', asOf: '2026-10-21' };
    expect(snapshotId(s)).toBe(snapshotId({ ...s }));
    expect(snapshotId({ ...s, asOf: '2026-10-22' })).not.toBe(snapshotId(s));
  });

  it('makes random IDs and device IDs', () => {
    expect(randomId('txn')).toMatch(/^txn_[a-z2-7]{26}$/);
    expect(randomId('txn')).not.toBe(randomId('txn'));
    expect(newDeviceId()).toMatch(/^[a-z2-7]{8}$/);
  });

  it('masks references and normalises names', () => {
    expect(mask('9100 1234 5678')).toBe('••••5678');
    expect(mask('12')).toBe('12');
    expect(normaliseName(' HDFC  Bank-Ltd. ')).toBe('hdfc bank ltd');
  });
});
