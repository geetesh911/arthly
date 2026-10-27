<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { LoanDirection } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app, attempt, changed, say } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { money, todayIso } from '#lib/forms.ts';

  let direction = $state<LoanDirection>('lent');
  let memberId = $state(app.filter.memberId ?? app.members[0]?.id ?? '');
  let party = $state('');
  let amount = $state('');
  let date = $state(todayIso());
  let due = $state('');
  let note = $state('');

  async function save(event: Event) {
    event.preventDefault();
    const id = await attempt(() =>
      api().addLoan({
        memberId,
        direction,
        party,
        amount: money(amount),
        date,
        ...(due ? { due } : {}),
        ...(note.trim() ? { note } : {}),
      }),
    );

    if (id) {
      say('Saved');
      await changed();
      await goto(`#/loans/${id}`);
    }
  }
</script>

<PageHeader title="Add a loan" back={{ href: '#/loans', label: 'Loans' }} />
<Card.Root class="max-w-2xl">
  <Card.Content>
    <form class="grid gap-4" onsubmit={save}>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Which way?">
          <NativeSelect bind:value={direction} class="w-full">
            <option value="lent">I lent money: they owe me</option>
            <option value="borrowed">I borrowed money: I owe them</option>
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
      <FormField
        label={direction === 'lent' ? 'Who owes you?' : 'Who do you owe?'}
        hint="A person or a party."
      >
        <Input bind:value={party} required autocomplete="off" />
      </FormField>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Amount (₹)">
          <Input inputmode="decimal" bind:value={amount} required />
        </FormField>
        <FormField label={direction === 'lent' ? 'Lent on' : 'Borrowed on'}>
          <Input type="date" bind:value={date} required />
        </FormField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Due by (optional)" hint="Shows in Coming up, and in Checks once overdue.">
          <Input type="date" bind:value={due} />
        </FormField>
        <FormField label="Note (optional)">
          <Input bind:value={note} autocomplete="off" />
        </FormField>
      </div>
      <Button type="submit" class="sm:justify-self-start">Save</Button>
    </form>
  </Card.Content>
</Card.Root>
