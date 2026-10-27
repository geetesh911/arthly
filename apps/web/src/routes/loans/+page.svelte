<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import HandCoins from '@lucide/svelte/icons/hand-coins';
  import Plus from '@lucide/svelte/icons/plus';
  import type { LoanDirection } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import LoanRow from '#lib/components/LoanRow.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import { inr, inrSigned } from '#lib/format.ts';
  import { LOAN_WORDS } from '#lib/loans.ts';
  import type { LoansDto } from '#lib/worker/dto.ts';

  let data = $state<LoansDto | null>(null);

  $effect(() => {
    void app.version;
    void api()
      .loans($state.snapshot(app.filter))
      .then((d) => (data = d));
  });

  const sides: { direction: LoanDirection; empty: string }[] = [
    { direction: 'lent', empty: 'Nobody owes you money.' },
    { direction: 'borrowed', empty: 'You don’t owe anyone.' },
  ];
  const settled = $derived(data?.loans.filter((l) => !l.open) ?? []);
  const showMember = $derived(app.members.length > 1 && !app.filter.memberId);
  const net = $derived(data ? data.owedToYou - data.youOwe : 0);
</script>

<PageHeader title="Loans" back={{ href: '#/more', label: 'More' }} backClass="lg:hidden">
  {#snippet actions()}
    <Button size="sm" href="#/loans/new"><Plus />Add a loan</Button>
  {/snippet}
</PageHeader>

{#if !data}
  <div class="grid gap-4">
    <Skeleton class="h-28 rounded-4xl" />
    <Skeleton class="h-48 rounded-4xl" />
  </div>
{:else if data.loans.length === 0}
  <Empty.Root class="min-h-[50dvh]">
    <Empty.Header>
      <Empty.Media variant="icon"><HandCoins /></Empty.Media>
      <Empty.Title>No loans yet</Empty.Title>
      <Empty.Description>
        Add money you lent or borrowed. Net worth adds what you’re owed and takes off what you owe.
      </Empty.Description>
    </Empty.Header>
    <Empty.Content><Button href="#/loans/new">Add a loan</Button></Empty.Content>
  </Empty.Root>
{:else}
  <Card.Root>
    <Card.Content class="grid grid-cols-2 gap-5 sm:grid-cols-3">
      <Stat label="Owed to you" value={inr(data.owedToYou)} testid="owed-to-you" />
      <Stat label="You owe" value={inr(data.youOwe)} testid="you-owe" />
      <Stat
        label="Net"
        value={inrSigned(net)}
        tone={net > 0 ? 'gain' : net < 0 ? 'loss' : undefined}
        hint="Counted in net worth"
      />
    </Card.Content>
  </Card.Root>

  <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
    {#each sides as side (side.direction)}
      {@const open = data.loans.filter((l) => l.open && l.direction === side.direction)}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg font-semibold">{LOAN_WORDS[side.direction].section}</Card.Title
          >
          <Card.Description>
            {open.length
              ? `${open.length} ${open.length === 1 ? 'loan' : 'loans'} · ${inr(
                  side.direction === 'lent' ? data.owedToYou : data.youOwe,
                )}`
              : side.empty}
          </Card.Description>
        </Card.Header>
        {#if open.length}
          <Card.Content class="grid px-2 sm:px-4">
            {#each open as loan (loan.id)}<LoanRow {loan} {showMember} />{/each}
          </Card.Content>
        {/if}
      </Card.Root>
    {/each}
  </div>

  {#if settled.length}
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-lg font-semibold">Settled</Card.Title>
        <Card.Description>Paid back or written off. They no longer count.</Card.Description>
      </Card.Header>
      <Card.Content class="grid px-2 sm:px-4">
        {#each settled as loan (loan.id)}<LoanRow {loan} {showMember} />{/each}
      </Card.Content>
    </Card.Root>
  {/if}
{/if}
