<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Wallet from '@lucide/svelte/icons/wallet';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import CheckList from '#lib/components/CheckList.svelte';
  import Donut from '#lib/components/Donut.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { Separator } from '#lib/components/ui/separator/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import * as Tabs from '#lib/components/ui/tabs/index.ts';
  import ValueChart from '#lib/components/ValueChart.svelte';
  import { CLASS_NAMES, date, inr, inrSigned, pct } from '#lib/format.ts';
  import type { OverviewDto } from '#lib/worker/dto.ts';

  let range = $state<'1m' | '1y' | 'all'>('1y');
  let by = $state<'assetClass' | 'member' | 'group'>('assetClass');
  let data = $state<OverviewDto | null>(null);

  $effect(() => {
    void app.version;
    const filter = $state.snapshot(app.filter);

    void api()
      .overview(filter, range)
      .then((d) => (data = d));
  });

  const young = $derived(
    !data?.firstFlow || Date.now() - Date.parse(data.firstFlow) < 365 * 86_400_000,
  );
  const slices = $derived(
    data
      ? by === 'assetClass'
        ? data.allocation.assetClass.map(([k, v]): [string, number] => [CLASS_NAMES[k] ?? k, v])
        : data.allocation[by]
      : [],
  );
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const hasLoans = $derived(!!data && (data.owedToYou > 0 || data.youOwe > 0));
  const hasCards = $derived(!!data && data.cardDues > 0);
  const notCharted = $derived(
    [hasLoans && 'Loans', hasCards && (hasLoans ? 'card dues' : 'Card dues')]
      .filter(Boolean)
      .join(' and '),
  );
</script>

{#if !data}
  <div class="grid gap-4">
    <Skeleton class="h-40 rounded-4xl" />
    <Skeleton class="h-72 rounded-4xl" />
  </div>
{:else if data.holdings === 0 && data.loans === 0 && data.cards === 0}
  <Empty.Root class="min-h-[60dvh]">
    <Empty.Header>
      <Empty.Media variant="icon"><Wallet /></Empty.Media>
      <Empty.Title>Welcome</Empty.Title>
      <Empty.Description>
        Add your first holdings: import a Groww holdings file or a PPF statement, or add an FD, PPF
        or EPF by hand.
      </Empty.Description>
    </Empty.Header>
    <Empty.Content><Button href="#/add">Add holdings</Button></Empty.Content>
  </Empty.Root>
{:else}
  <div class="grid gap-4 lg:grid-cols-3">
    <Card.Root class="lg:col-span-3">
      <Card.Content class="grid gap-5">
        <div>
          <p class="text-muted-foreground text-sm">Net worth</p>
          <p class="text-4xl font-semibold tracking-tight tabular-nums" data-testid="net-worth">
            {inr(data.netWorth)}
          </p>
          {#if hasLoans || hasCards}
            <p class="text-muted-foreground text-sm" data-testid="net-worth-parts">
              {[
                `Investments ${inr(data.investments)}`,
                data.owedToYou > 0 && `owed to you ${inr(data.owedToYou)}`,
                data.youOwe > 0 && `you owe ${inr(data.youOwe)}`,
                hasCards && `card dues ${inr(data.cardDues)}`,
              ]
                .filter(Boolean)
                .join(' · ')} ·
              {#if hasLoans}
                <a href="#/loans" class="text-foreground underline underline-offset-4">Loans</a>
              {/if}
              {#if hasLoans && hasCards}·{/if}
              {#if hasCards}
                <a href="#/cards" class="text-foreground underline underline-offset-4">Cards</a>
              {/if}
            </p>
          {/if}
        </div>
        <Separator />
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Net invested" value={inr(data.netInvested)} />
          <Stat
            label="Total gain"
            value={inrSigned(data.totalGain)}
            tone={data.totalGain >= 0 ? 'gain' : 'loss'}
          />
          {#if young}
            <Stat label="Return" value={pct(data.absoluteReturn)} />
          {:else}
            <Stat
              label={`XIRR${data.xirrEstimate ? ' ≈' : ''}`}
              value={`${data.xirrEstimate ? '≈ ' : ''}${pct(data.xirr)}`}
            />
          {/if}
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root class="lg:col-span-2">
      <Card.Header>
        <Card.Title class="text-lg font-semibold">Value</Card.Title>
        <Card.Action>
          <Tabs.Root bind:value={range}>
            <Tabs.List>
              <Tabs.Trigger value="1m">1M</Tabs.Trigger>
              <Tabs.Trigger value="1y">1Y</Tabs.Trigger>
              <Tabs.Trigger value="all">All</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </Card.Action>
      </Card.Header>
      <!-- On wide screens the chart grows to the height of the allocation card beside it. -->
      <Card.Content class="flex flex-1 flex-col gap-2">
        <ValueChart points={data.history} class="lg:h-auto lg:min-h-52 lg:flex-1" />
        {#if data.history.some((p) => p.costOnly)}
          <p class="text-muted-foreground text-xs">
            Some early values use cost, because no price was known yet.
          </p>
        {/if}
        {#if notCharted}
          <p class="text-muted-foreground text-xs">
            Investments only. {notCharted} aren’t in this chart.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="text-lg font-semibold">Allocation</Card.Title>
        <Card.Action>
          <NativeSelect bind:value={by} aria-label="Group allocation by" size="sm">
            <option value="assetClass">By asset class</option>
            <option value="member">By member</option>
            <option value="group">By group</option>
          </NativeSelect>
        </Card.Action>
      </Card.Header>
      <Card.Content><Donut {slices} /></Card.Content>
      <Card.Footer
        ><Button variant="outline" size="sm" href="#/analytics">Explore analytics</Button
        ></Card.Footer
      >
    </Card.Root>
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <Card.Root>
      <Card.Header><Card.Title class="text-lg font-semibold">Worth a look</Card.Title></Card.Header>
      <Card.Content><CheckList checks={data.checks} limit={3} /></Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title class="text-lg font-semibold">Coming up</Card.Title></Card.Header>
      <Card.Content>
        {#if data.upcoming.length === 0}
          <p class="text-muted-foreground text-sm">Nothing in the next 30 days.</p>
        {:else}
          <ul class="grid grid-cols-1 gap-1">
            {#each data.upcoming as u, i (i)}
              <li class="flex items-center gap-3 py-1.5">
                <span
                  class="bg-muted grid size-11 shrink-0 place-items-center rounded-2xl text-center leading-none"
                >
                  <span class="text-sm font-semibold">{day(u.date).getUTCDate()}</span>
                  <span class="text-muted-foreground text-[10px] uppercase"
                    >{day(u.date).toLocaleDateString('en-IN', {
                      month: 'short',
                      timeZone: 'UTC',
                    })}</span
                  >
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{u.name}</span>
                  <span class="text-muted-foreground flex items-center gap-2 text-xs"
                    >{u.kind}{u.estimated ? ' (estimate)' : ''}{#if u.overdue}<Badge
                        variant="destructive">Overdue</Badge
                      >{/if}</span
                  >
                </span>
                <span class="text-sm font-medium tabular-nums">{inr(u.amount)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <p class="text-muted-foreground text-xs">
    Prices updated {data.pricesAsOf ? date(data.pricesAsOf) : 'never'} · As of {date(data.date)}
  </p>
{/if}
