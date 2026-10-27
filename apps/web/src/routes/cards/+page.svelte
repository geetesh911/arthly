<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import CreditCard from '@lucide/svelte/icons/credit-card';
  import Plus from '@lucide/svelte/icons/plus';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import CardRow from '#lib/components/CardRow.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import { date, inr } from '#lib/format.ts';
  import type { CardsDto } from '#lib/worker/dto.ts';

  let data = $state<CardsDto | null>(null);

  $effect(() => {
    void app.version;
    void api()
      .cards($state.snapshot(app.filter))
      .then((d) => (data = d));
  });

  const open = $derived(data?.cards.filter((c) => !c.closed) ?? []);
  const closed = $derived(data?.cards.filter((c) => c.closed) ?? []);
  const showMember = $derived(app.members.length > 1 && !app.filter.memberId);
  const late = $derived(!!data?.nextDue && data.nextDue < data.date);
</script>

<PageHeader title="Cards" back={{ href: '#/more', label: 'More' }} backClass="lg:hidden">
  {#snippet actions()}
    <Button size="sm" href="#/cards/new"><Plus />Add a card</Button>
  {/snippet}
</PageHeader>

{#if !data}
  <div class="grid gap-4">
    <Skeleton class="h-28 rounded-4xl" />
    <Skeleton class="h-48 rounded-4xl" />
  </div>
{:else if data.cards.length === 0}
  <Empty.Root class="min-h-[50dvh]">
    <Empty.Header>
      <Empty.Media variant="icon"><CreditCard /></Empty.Media>
      <Empty.Title>No cards yet</Empty.Title>
      <Empty.Description>
        Add a credit card and type in its bills. Net worth takes off what’s left to pay.
      </Empty.Description>
    </Empty.Header>
    <Empty.Content><Button href="#/cards/new">Add a card</Button></Empty.Content>
  </Empty.Root>
{:else}
  <Card.Root>
    <Card.Content class="grid grid-cols-2 gap-5">
      <Stat
        label="Card dues"
        value={inr(data.dues)}
        hint="Taken off net worth"
        testid="card-dues"
      />
      <Stat
        label="Next due"
        value={!data.nextDue ? 'Nothing due' : late ? 'Overdue' : date(data.nextDue)}
        tone={late ? 'loss' : undefined}
        hint={late ? `Since ${date(data.nextDue)}` : undefined}
      />
    </Card.Content>
  </Card.Root>

  <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-lg font-semibold">Your cards</Card.Title>
        <Card.Description>
          {open.length
            ? `${open.length} ${open.length === 1 ? 'card' : 'cards'} · ${inr(data.dues)} left to pay`
            : 'All your cards are closed.'}
        </Card.Description>
      </Card.Header>
      {#if open.length}
        <Card.Content class="grid px-2 sm:px-4">
          {#each open as card (card.id)}<CardRow {card} {showMember} />{/each}
        </Card.Content>
      {/if}
      <Card.Footer>
        <Button variant="outline" size="sm" href="#/cards/bill">Add a bill</Button>
      </Card.Footer>
    </Card.Root>

    {#if closed.length}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg font-semibold">Closed</Card.Title>
          <Card.Description>Cards you no longer use. Their history stays.</Card.Description>
        </Card.Header>
        <Card.Content class="grid px-2 sm:px-4">
          {#each closed as card (card.id)}<CardRow {card} {showMember} />{/each}
        </Card.Content>
      </Card.Root>
    {/if}
  </div>
{/if}
