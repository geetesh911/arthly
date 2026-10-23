// SPDX-License-Identifier: AGPL-3.0-only
// Made-up holdings for "Try with sample data". Nothing here is real.
import {
  addDays,
  addMonths,
  putEvent,
  type Clock,
  type EntityMap,
  type EntityName,
  type Event,
} from '@pv/core';

export function sampleEvents(clock: Clock, today: string): Event[] {
  const events: Event[] = [];
  const put = <K extends EntityName>(entity: K, value: EntityMap[K]) =>
    events.push(putEvent(clock.next(), entity, value));
  const manual = { kind: 'manual' } as const;
  const start = addMonths(today, -30);

  put('member', { id: 'mem_demo1', name: 'Asha' });
  put('member', { id: 'mem_demo2', name: 'Ravi' });
  put('account', {
    id: 'acc_demo_mf',
    memberId: 'mem_demo1',
    institution: 'Sample AMC',
    kind: 'mf',
    label: 'Sample AMC folio ••••1234',
    currency: 'INR',
  });
  put('account', {
    id: 'acc_demo_demat',
    memberId: 'mem_demo1',
    institution: 'Sample Broker',
    kind: 'demat',
    label: 'Demat ••••5678',
    currency: 'INR',
  });
  put('account', {
    id: 'acc_demo_bank',
    memberId: 'mem_demo2',
    institution: 'Sample Bank',
    kind: 'bank',
    label: 'Sample Bank',
    currency: 'INR',
  });
  put('account', {
    id: 'acc_demo_ppf',
    memberId: 'mem_demo2',
    institution: 'Sample Bank',
    kind: 'ppf',
    label: 'PPF ••••9012',
    currency: 'INR',
  });

  put('instrument', {
    id: 'ins_demo_flexi',
    kind: 'mf',
    name: 'Sample Flexi Cap Fund Direct Growth',
    currency: 'INR',
    assetClass: 'equity',
    ids: {},
  });
  put('instrument', {
    id: 'ins_demo_gold',
    kind: 'etf',
    name: 'Sample Gold ETF',
    currency: 'INR',
    assetClass: 'gold',
    ids: {},
  });
  put('instrument', {
    id: 'ins_demo_ppf',
    kind: 'ppf',
    name: 'PPF',
    currency: 'INR',
    assetClass: 'debt',
    ids: {},
  });
  put('instrument', {
    id: 'ins_demo_fd',
    kind: 'fd',
    name: 'Sample Bank FD',
    currency: 'INR',
    assetClass: 'debt',
    ids: {},
    terms: {
      principal: 200_000,
      start: addMonths(today, -8),
      maturity: addMonths(today, 1),
      ratePct: 7.1,
      compounding: 'quarterly',
      payout: 'cumulative',
    },
  });

  let nav = 50;
  for (let m = 0; m < 30; m++) {
    const date = addMonths(start, m);
    nav *= 1.012;
    put('transaction', {
      id: `txn_demo_sip${m}`,
      accountId: 'acc_demo_mf',
      instrumentId: 'ins_demo_flexi',
      date,
      type: 'buy',
      units: 5000 / nav,
      price: nav,
      amount: 5000,
      currency: 'INR',
      source: manual,
    });
    put('manualPrice', {
      id: `mp_demo_flexi${m}`,
      instrumentId: 'ins_demo_flexi',
      date,
      price: nav,
    });
  }
  put('manualPrice', {
    id: 'mp_demo_flexi_now',
    instrumentId: 'ins_demo_flexi',
    date: addDays(today, -1),
    price: nav * 1.01,
  });
  put('transaction', {
    id: 'txn_demo_gold',
    accountId: 'acc_demo_demat',
    instrumentId: 'ins_demo_gold',
    date: addMonths(today, -14),
    type: 'buy',
    units: 1000,
    price: 60,
    amount: 60_000,
    currency: 'INR',
    source: manual,
  });
  put('manualPrice', {
    id: 'mp_demo_gold',
    instrumentId: 'ins_demo_gold',
    date: addDays(today, -1),
    price: 82,
  });
  put('transaction', {
    id: 'txn_demo_fd',
    accountId: 'acc_demo_bank',
    instrumentId: 'ins_demo_fd',
    date: addMonths(today, -8),
    type: 'contribution',
    amount: 200_000,
    currency: 'INR',
    source: manual,
  });
  for (let y = 0; y < 3; y++) {
    put('transaction', {
      id: `txn_demo_ppf${y}`,
      accountId: 'acc_demo_ppf',
      instrumentId: 'ins_demo_ppf',
      date: addMonths(start, 12 * y),
      type: 'contribution',
      amount: 150_000,
      currency: 'INR',
      source: manual,
    });
  }
  put('group', {
    id: 'grp_demo',
    name: 'Long term',
    holdings: [{ instrumentId: 'ins_demo_flexi' }, { instrumentId: 'ins_demo_gold' }],
  });
  return events;
}
