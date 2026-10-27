<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { goto } from '$app/navigation';

  import { api } from '#lib/api.ts';
  import { app, attempt, changed, say } from '#lib/app.svelte.ts';
  import BillFields from '#lib/components/BillFields.svelte';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { money } from '#lib/forms.ts';

  let memberId = $state(app.filter.memberId ?? app.members[0]?.id ?? '');
  let bank = $state('');
  let name = $state('');
  let limit = $state('');
  let amount = $state('');
  let minimumDue = $state('');
  let statementDate = $state('');
  let dueDate = $state('');

  // The first bill is optional, but once any of it is typed, all of it is needed.
  const withBill = $derived(!!(amount || minimumDue || statementDate || dueDate));

  async function save(event: Event) {
    event.preventDefault();
    const id = await attempt(() =>
      api().addCard({
        memberId,
        bank,
        name,
        ...(limit.trim() ? { limit: money(limit) } : {}),
        ...(withBill
          ? {
              bill: {
                amount: money(amount),
                minimumDue: money(minimumDue),
                statementDate,
                dueDate,
              },
            }
          : {}),
      }),
    );

    if (id) {
      say('Saved');
      await changed();
      await goto(`#/cards/${id}`);
    }
  }
</script>

<PageHeader title="Add a card" back={{ href: '#/cards', label: 'Cards' }} />
<Card.Root class="max-w-2xl">
  <Card.Content>
    <form class="grid gap-4" onsubmit={save}>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Bank" hint="Who issued the card.">
          <Input bind:value={bank} required autocomplete="off" />
        </FormField>
        <FormField label="Name" hint="What you call it, such as Travel card.">
          <Input bind:value={name} required autocomplete="off" />
        </FormField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {#if app.members.length > 1}
          <FormField label="Whose?">
            <NativeSelect bind:value={memberId} class="w-full">
              {#each app.members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
            </NativeSelect>
          </FormField>
        {/if}
        <FormField label="Credit limit (₹, optional)">
          <Input inputmode="decimal" bind:value={limit} />
        </FormField>
      </div>
      <p class="text-muted-foreground text-xs">No card number is needed, and none is kept.</p>

      <h2 class="mt-2 text-base font-semibold">First bill (optional)</h2>
      <BillFields bind:amount bind:minimumDue bind:statementDate bind:dueDate required={withBill} />
      <Button type="submit" class="sm:justify-self-start">Save</Button>
    </form>
  </Card.Content>
</Card.Root>
