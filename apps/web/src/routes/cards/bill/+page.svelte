<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { goto } from '$app/navigation';

  import { api } from '#lib/api.ts';
  import { app, attempt, changed, say } from '#lib/app.svelte.ts';
  import { cardName } from '#lib/cards.ts';
  import BillFields from '#lib/components/BillFields.svelte';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import { addressParam, money } from '#lib/forms.ts';
  import type { CardDto } from '#lib/worker/dto.ts';

  let cards = $state<CardDto[] | null>(null);
  let cardId = $state(addressParam('card') ?? '');
  let amount = $state('');
  let minimumDue = $state('');
  let statementDate = $state('');
  let dueDate = $state('');

  $effect(() => {
    void app.version;
    void api()
      .cards()
      .then((d) => {
        cards = d.cards.filter((c) => !c.closed || c.id === cardId);

        if (!cards.some((c) => c.id === cardId)) {
          cardId = cards[0]?.id ?? '';
        }
      });
  });

  const showMember = $derived(app.members.length > 1);

  async function save(event: Event) {
    event.preventDefault();
    const id = await attempt(() =>
      api().addBill({
        cardId,
        amount: money(amount),
        minimumDue: money(minimumDue),
        statementDate,
        dueDate,
      }),
    );

    if (id) {
      say('Saved');
      await changed();
      await goto(`#/cards/${cardId}`);
    }
  }
</script>

<PageHeader title="Add a bill" back={{ href: '#/cards', label: 'Cards' }} />
<Card.Root class="max-w-2xl">
  <Card.Content>
    {#if !cards}
      <Skeleton class="h-40 rounded-2xl" />
    {:else if cards.length === 0}
      <div class="grid gap-3">
        <p class="text-muted-foreground text-sm">
          Add the card first. Its first bill can go in too.
        </p>
        <Button href="#/cards/new" class="justify-self-start">Add a card</Button>
      </div>
    {:else}
      <form class="grid gap-4" onsubmit={save}>
        <FormField label="Card">
          <NativeSelect bind:value={cardId} class="w-full">
            {#each cards as c (c.id)}
              <option value={c.id}>{cardName(c)}{showMember ? ` (${c.memberName})` : ''}</option>
            {/each}
          </NativeSelect>
        </FormField>
        <BillFields bind:amount bind:minimumDue bind:statementDate bind:dueDate />
        <p class="text-muted-foreground text-xs">
          A new bill replaces whatever was left on the last one, since it already includes it.
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <Button type="submit">Save</Button>
          <Button variant="ghost" href="#/cards/new">Add a card</Button>
        </div>
      </form>
    {/if}
  </Card.Content>
</Card.Root>
