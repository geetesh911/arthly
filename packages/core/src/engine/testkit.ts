// SPDX-License-Identifier: AGPL-3.0-only
// Helpers for engine tests: build a state from plain records.
import { importApplyEvent, putEvent, type Event, type ImportApplyData } from '../log/events.ts';
import { formatHlc } from '../log/hlc.ts';
import { replay, type State } from '../log/replay.ts';
import type { Account, EntityMap, EntityName, Instrument, Transaction } from '../model/types.ts';

export class Ledger {
  private events: Event[] = [];
  private n = 0;

  put<K extends EntityName>(entity: K, value: EntityMap[K]): this {
    this.events.push(
      putEvent(formatHlc(1_700_000_000_000 + this.n++, 0, 'testtest'), entity, value),
    );
    return this;
  }

  import(data: Omit<ImportApplyData, 'file' | 'importer'> & Partial<ImportApplyData>): this {
    this.events.push(
      importApplyEvent(formatHlc(1_700_000_000_000 + this.n++, 0, 'testtest'), {
        importer: { id: 'groww-mf-holdings', version: 1 },
        file: { name: 'f.xlsx', sha256: 'x', size: 1 },
        ...data,
      }),
    );
    return this;
  }

  member(id = 'mem_1', name = 'Asha'): this {
    return this.put('member', { id, name });
  }

  account(a: Partial<Account> & { id: string }): this {
    return this.put('account', {
      memberId: 'mem_1',
      institution: 'Bank',
      kind: 'other',
      label: a.id,
      currency: 'INR',
      ...a,
    });
  }

  instrument(i: Partial<Instrument> & { id: string; kind: Instrument['kind'] }): this {
    return this.put('instrument', {
      name: i.id,
      currency: 'INR',
      assetClass: 'equity',
      ids: {},
      ...i,
    });
  }

  txn(t: Partial<Transaction> & Pick<Transaction, 'date' | 'type' | 'amount'>): this {
    return this.put('transaction', {
      id: `txn_${this.n}`,
      accountId: 'acc_1',
      instrumentId: 'ins_1',
      currency: 'INR',
      source: { kind: 'manual' },
      ...t,
    });
  }

  state(): State {
    return replay(this.events);
  }

  all(): Event[] {
    return [...this.events];
  }
}
