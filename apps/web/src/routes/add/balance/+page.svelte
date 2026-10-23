<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, list } from '#lib/api.ts';
  import { app, attempt, changed, say } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { ensureAccount, money, newInstrument, todayIso } from '#lib/forms.ts';
  import { randomId, snapshotId, type Instrument } from '@pv/core';

  let kind = $state<'ppf' | 'epf' | 'cash'>('ppf');
  let memberId = $state(app.filter.memberId ?? app.members[0]?.id ?? '');
  let institution = $state('');
  let ref = $state('');
  let opened = $state('');
  let entry = $state<'contribution' | 'withdrawal' | 'interest' | 'balance'>('contribution');
  let part = $state<'employee' | 'employer' | 'pension'>('employee');
  let date = $state(todayIso());
  let amount = $state('');
  let instruments = $state<Instrument[]>([]);

  onMount(async () => (instruments = await list('instrument')));

  async function instrumentFor(
    kindNeeded: 'ppf' | 'epf' | 'eps' | 'cash',
    accountId: string,
    name: string,
  ) {
    const txns = await list('transaction');
    const snaps = await list('snapshot');
    const used = new Set(
      [...txns, ...snaps].filter((t) => t.accountId === accountId).map((t) => t.instrumentId),
    );
    const existing = instruments.find((i) => i.kind === kindNeeded && used.has(i.id));
    if (existing) return existing.id;
    return newInstrument({
      kind: kindNeeded,
      name,
      ...(kindNeeded === 'ppf' && opened ? { terms: { opened } } : {}),
    });
  }

  async function save(event: Event) {
    event.preventDefault();
    const done = await attempt(async () => {
      const masked = ref ? `••••${ref.replace(/\s/g, '').slice(-4)}` : undefined;
      const accountKind = kind === 'cash' ? 'bank' : kind;
      const label = `${institution} ${kind === 'cash' ? 'savings' : kind.toUpperCase()}${masked ? ` ${masked}` : ''}`;
      const accountId = await ensureAccount({
        memberId,
        institution,
        kind: accountKind,
        label,
        ...(masked ? { ref: masked } : {}),
      });
      const target = kind === 'epf' && part === 'pension' ? 'eps' : kind;
      const instrumentId = await instrumentFor(
        target,
        accountId,
        target === 'eps'
          ? `EPS (${institution})`
          : target === 'cash'
            ? `${institution} savings`
            : `${kind.toUpperCase()} (${institution})`,
      );
      if (kind === 'cash' || entry === 'balance') {
        const value = money(amount);
        await api().save('snapshot', {
          id: snapshotId({ accountId, instrumentId, asOf: date }),
          accountId,
          instrumentId,
          asOf: date,
          units: value,
          value,
          source: { kind: 'manual' },
        });
      } else {
        await api().save('transaction', {
          id: randomId('txn'),
          accountId,
          instrumentId,
          date,
          type: entry,
          amount: money(amount),
          currency: 'INR',
          ...(kind === 'epf' ? { meta: { part } } : {}),
          source: { kind: 'manual' },
        });
      }
      return `${accountId}|${instrumentId}`;
    });
    if (done) {
      say('Saved');
      amount = '';
      await changed();
    }
  }
</script>

<PageHeader title="Add a PPF, EPF or cash entry" back={{ href: '#/add', label: 'Add' }} />
<Card.Root class="max-w-2xl">
  <Card.Content>
    <form class="grid gap-4" onsubmit={save}>
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField label="Account type">
          <NativeSelect bind:value={kind} class="w-full">
            <option value="ppf">PPF</option>
            <option value="epf">EPF</option>
            <option value="cash">Bank cash balance</option>
          </NativeSelect>
        </FormField>
        {#if app.members.length > 1}
          <FormField label="Whose?">
            <NativeSelect bind:value={memberId} class="w-full">
              {#each app.members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
            </NativeSelect>
          </FormField>
        {/if}
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField label={kind === 'epf' ? 'Employer or EPF office' : 'Bank'}>
          <Input bind:value={institution} required />
        </FormField>
        <FormField
          label={kind === 'epf' ? 'Member ID' : 'Account number'}
          hint="Only the last 4 are kept."
        >
          <Input bind:value={ref} autocomplete="off" />
        </FormField>
      </div>
      {#if kind === 'ppf'}
        <FormField label="Account opened on" hint="Sets the 15-year maturity.">
          <Input type="date" bind:value={opened} />
        </FormField>
      {/if}
      {#if kind !== 'cash'}
        <div class="grid gap-4 sm:grid-cols-2">
          <FormField label="Entry">
            <NativeSelect bind:value={entry} class="w-full">
              <option value="contribution">{kind === 'ppf' ? 'Deposit' : 'Contribution'}</option>
              <option value="interest">Interest credited</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="balance">Balance on a date (if you don't have the history)</option>
            </NativeSelect>
          </FormField>
          {#if kind === 'epf' && entry === 'contribution'}
            <FormField label="Share">
              <NativeSelect bind:value={part} class="w-full">
                <option value="employee">Employee</option>
                <option value="employer">Employer</option>
                <option value="pension">Pension (EPS)</option>
              </NativeSelect>
            </FormField>
          {/if}
        </div>
      {/if}
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField label="Date"><Input type="date" bind:value={date} required /></FormField>
        <FormField label={`${kind === 'cash' || entry === 'balance' ? 'Balance' : 'Amount'} (₹)`}>
          <Input inputmode="decimal" bind:value={amount} required />
        </FormField>
      </div>
      <Button type="submit" class="sm:justify-self-start">Save</Button>
    </form>
  </Card.Content>
</Card.Root>
