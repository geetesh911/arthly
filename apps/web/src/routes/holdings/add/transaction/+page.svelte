<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { type Account, type Instrument, randomId, type TransactionType } from '@pv/core';

  import { api, list } from '#lib/api.ts';
  import { attempt, changed, say } from '#lib/app.svelte.ts';
  import { backLink } from '#lib/back.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { holdingRef, money, todayIso } from '#lib/forms.ts';

  const back = backLink({ href: '#/holdings', label: 'Holdings' });
  let accounts = $state<Account[]>([]);
  let instruments = $state<Instrument[]>([]);
  let accountId = $state('');
  let instrumentId = $state('');
  let type = $state<TransactionType>('buy');
  let date = $state(todayIso());
  let units = $state('');
  let amount = $state('');

  const TYPES: [TransactionType, string][] = [
    ['buy', 'Buy'],
    ['sell', 'Sell'],
    ['dividend', 'Dividend paid out'],
    ['dividend-reinvest', 'Dividend reinvested'],
    ['interest', 'Interest'],
    ['contribution', 'Deposit / contribution'],
    ['withdrawal', 'Withdrawal'],
    ['maturity', 'Maturity payout'],
    ['bonus', 'Bonus units'],
    ['split', 'Split (extra units)'],
    ['charge', 'Charge'],
    ['tax', 'Tax deducted'],
  ];
  const needsUnits = $derived(
    ['buy', 'sell', 'dividend-reinvest', 'bonus', 'split', 'switch-in', 'switch-out'].includes(
      type,
    ),
  );

  onMount(async () => {
    [accounts, instruments] = await Promise.all([list('account'), list('instrument')]);
    const ref = holdingRef();

    if (ref) {
      [accountId, instrumentId] = ref;

      if (location.hash.includes('record-')) {
        type = 'sell';
      }
    }
  });

  async function save(event: Event) {
    event.preventDefault();
    const value = {
      id: randomId('txn'),
      accountId,
      instrumentId,
      date,
      type,
      ...(needsUnits && units ? { units: Number(units) } : {}),
      amount: type === 'bonus' || type === 'split' ? 0 : money(amount),
      currency: instruments.find((i) => i.id === instrumentId)?.currency ?? 'INR',
      source: { kind: 'manual' as const },
    };

    if ((await attempt(() => api().save('transaction', value))) !== undefined) {
      say('Saved');
      await changed();
      await goto(`#/holdings/${encodeURIComponent(`${accountId}|${instrumentId}`)}`);
    }
  }
</script>

<PageHeader title="Add a transaction" back={back.current} />
<Card.Root class="max-w-2xl">
  <Card.Content>
    <form class="grid gap-4" onsubmit={save}>
      <FormField label="Account">
        <NativeSelect bind:value={accountId} required class="w-full">
          <option value="" disabled>Choose…</option>
          {#each accounts as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
        </NativeSelect>
      </FormField>
      <FormField
        label="Holding"
        hint="Not listed? Add it from an import, or as an FD, bond, PPF or EPF."
      >
        <NativeSelect bind:value={instrumentId} required class="w-full">
          <option value="" disabled>Choose…</option>
          {#each instruments as i (i.id)}<option value={i.id}>{i.name}</option>{/each}
        </NativeSelect>
      </FormField>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Type">
          <NativeSelect bind:value={type} class="w-full">
            {#each TYPES as [k, label] (k)}<option value={k}>{label}</option>{/each}
          </NativeSelect>
        </FormField>
        <FormField label="Date"><Input type="date" bind:value={date} required /></FormField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {#if needsUnits}
          <FormField label="Units">
            <Input inputmode="decimal" bind:value={units} required />
          </FormField>
        {/if}
        {#if type !== 'bonus' && type !== 'split'}
          <FormField label="Amount (₹)">
            <Input inputmode="decimal" bind:value={amount} required />
          </FormField>
        {/if}
      </div>
      <Button type="submit" class="sm:justify-self-start">Save</Button>
    </form>
  </Card.Content>
</Card.Root>
