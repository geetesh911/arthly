<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Info from '@lucide/svelte/icons/info';
  import Wallet from '@lucide/svelte/icons/wallet';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import BottomSheet from '#lib/components/BottomSheet.svelte';
  import StackedBar from '#lib/components/StackedBar.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import * as Tabs from '#lib/components/ui/tabs/index.ts';
  import ValueChart from '#lib/components/ValueChart.svelte';
  import { CLASS_NAMES, date, inr, inrSigned, pct } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';
  import type { OverviewDto } from '#lib/worker/dto.ts';

  let range = $state<'1m' | '1y' | 'all'>('1y');
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
  const mix = $derived(
    (data?.allocation.assetClass ?? []).map(([k, v]): [string, number] => [CLASS_NAMES[k] ?? k, v]),
  );
  // Below a rupee is rounding, not a sale or payout.
  const realised = $derived(!!data && Math.abs(data.realised) >= 1);
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const hasLoans = $derived(!!data && (data.owedToYou > 0 || data.youOwe > 0));
  const hasCards = $derived(!!data && data.cardDues > 0);
  const tone = (n: number) => (n >= 0 ? 'text-gain' : 'text-loss');
  type Figure = { label: string; value: string; tone?: 'gain' | 'loss'; testid?: string };
  // Investments repeats net worth unless loans or cards set them apart.
  const stats = $derived.by(() => {
    if (!data) {
      return [];
    }

    const list: (Figure | false)[] = [
      (hasLoans || hasCards) && { label: 'Investments', value: inr(data.investments) },
      { label: 'Invested', value: inr(data.invested), testid: 'invested' },
      realised && {
        label: 'Realised',
        value: inrSigned(data.realised),
        tone: data.realised >= 0 ? 'gain' : 'loss',
        testid: 'realised',
      },
      young
        ? { label: 'Return', value: pct(data.absoluteReturn) }
        : {
            label: `XIRR${data.xirrEstimate ? ' ≈' : ''}`,
            value: `${data.xirrEstimate ? '≈ ' : ''}${pct(data.xirr)}`,
          },
    ];

    return list.filter((s): s is Figure => !!s);
  });
  const check = $derived(data?.checks[0]);
</script>

{#snippet hero(more: boolean)}
  <span class="text-muted-foreground text-small flex items-center gap-1"
    >Net worth{#if more}<ChevronDown class="size-3.5" />{/if}</span
  >
  <span class="text-hero font-semibold tabular-nums" data-testid="net-worth"
    >{inr(data!.netWorth)}</span
  >
  {#if data!.invested > 0}
    <span class="text-body text-muted-foreground"
      ><span class={cn('font-semibold', tone(data!.gain))}
        ><span data-testid="gain">{inrSigned(data!.gain)}</span>
        ({pct(data!.gain / data!.invested, 1)})</span
      > gain on what you hold</span
    >
  {/if}
{/snippet}

{#snippet part(label: string, value: string, href?: string, hint?: string)}
  <li class="flex min-h-14 items-center gap-3 border-b">
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="text-body">{label}</span>
      {#if hint}
        <a {href} class="text-muted-foreground text-small underline underline-offset-4">{hint}</a>
      {/if}
    </span>
    <span class="text-body tabular-nums">{value}</span>
  </li>
{/snippet}

{#if !data}
  <div class="grid gap-8">
    <Skeleton class="h-24 rounded-2xl" />
    <Skeleton class="h-56 rounded-2xl" />
  </div>
{:else if data.holdings === 0 && data.loans === 0 && data.cards === 0}
  <Empty.Root class="min-h-[60dvh]">
    <Empty.Header>
      <Empty.Media variant="icon"><Wallet /></Empty.Media>
      <Empty.Title>Welcome</Empty.Title>
      <Empty.Description>
        Start by importing a Groww holdings file or a PPF or EPF statement. For an FD, a loan or a
        card, use Add.
      </Empty.Description>
    </Empty.Header>
    <Empty.Content><Button href="#/import">Import files</Button></Empty.Content>
  </Empty.Root>
{:else}
  <!-- One column on phones; on wide screens the mix and what's next sit beside the chart. -->
  <div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12">
    <section aria-label="Net worth" class="grid grid-cols-1 content-start gap-4">
      {#if hasLoans || hasCards}
        <BottomSheet title="Net worth">
          {#snippet trigger(props)}
            <button {...props} type="button" class="grid justify-items-start gap-1 text-left"
              >{@render hero(true)}</button
            >
          {/snippet}
          <ul class="grid" data-testid="net-worth-parts">
            {@render part('Investments', inr(data.investments))}
            {#if data.owedToYou > 0}
              {@render part('Owed to you', inrSigned(data.owedToYou), '#/loans', 'Loans')}
            {/if}
            {#if data.youOwe > 0}
              {@render part('You owe', inrSigned(-data.youOwe), '#/loans', 'Loans')}
            {/if}
            {#if hasCards}
              {@render part('Card dues', inrSigned(-data.cardDues), '#/cards', 'Cards')}
            {/if}
            <li class="flex min-h-14 items-center gap-3">
              <span class="text-body flex-1 font-semibold">Net worth</span>
              <span class="text-title font-semibold tabular-nums">{inr(data.netWorth)}</span>
            </li>
          </ul>
          <p class="text-muted-foreground text-small">The chart shows investments only.</p>
        </BottomSheet>
      {:else}
        <div class="grid gap-1">{@render hero(false)}</div>
      {/if}

      <div class="grid gap-2">
        <ValueChart points={data.history} />
        {#if data.history.some((p) => p.costOnly)}
          <p class="text-muted-foreground text-small">
            Early values use cost, as no price was known yet.
          </p>
        {/if}
      </div>

      <Tabs.Root bind:value={range}>
        <Tabs.List aria-label="Chart range" class="grid h-10! w-full grid-cols-3">
          <Tabs.Trigger value="1m">1M</Tabs.Trigger>
          <Tabs.Trigger value="1y">1Y</Tabs.Trigger>
          <Tabs.Trigger value="all">All</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      <div class={cn('grid gap-3', stats.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {#each stats as s (s.label)}
          <Stat label={s.label} value={s.value} tone={s.tone} testid={s.testid} />
        {/each}
      </div>
    </section>

    <div class="grid grid-cols-1 content-start gap-8">
      {#if mix.length}
        <section aria-label="Your mix" class="grid gap-3">
          <a
            href="#/insights"
            class="-my-2 flex min-h-11 items-center justify-between"
            aria-label="Your mix, see Insights"
          >
            <h2 class="text-title font-semibold">Your mix</h2>
            <span class="text-muted-foreground text-small flex items-center gap-0.5"
              >Insights<ChevronRight class="size-4" /></span
            >
          </a>
          <StackedBar slices={mix} label="Your mix" />
        </section>
      {/if}

      {#if check}
        {@const Icon = check.severity === 'warn' ? CircleAlert : Info}
        <a href="#/checks" class="bg-muted flex items-center gap-3 rounded-2xl px-4 py-3.5">
          <Icon
            class={cn(
              'size-5 shrink-0',
              check.severity === 'warn' ? 'text-warn' : 'text-muted-foreground',
            )}
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-body font-semibold">{check.message}</span>
            <span class="text-muted-foreground text-small"
              >{data.checks.length > 1
                ? `${data.checks.length - 1} more to look at`
                : 'Worth a look'}</span
            >
          </span>
          <ChevronRight class="text-muted-foreground size-4 shrink-0" />
        </a>
      {/if}

      {#if data.upcoming.length}
        <section aria-labelledby="coming-up" class="grid grid-cols-1 gap-3">
          <h2 id="coming-up" class="text-title font-semibold">Coming up</h2>
          <ul class="grid grid-cols-1">
            {#each data.upcoming as u, i (i)}
              <li class="flex min-h-14 items-center gap-3 py-1.5">
                <span
                  class="grid size-11 shrink-0 place-content-center rounded-xl border text-center leading-none"
                >
                  <span class="text-body font-semibold">{day(u.date).getUTCDate()}</span>
                  <span class="text-muted-foreground mt-0.5 text-[11px] uppercase"
                    >{day(u.date).toLocaleDateString('en-IN', {
                      month: 'short',
                      timeZone: 'UTC',
                    })}</span
                  >
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="text-body truncate font-semibold">{u.name}</span>
                  <span class="text-muted-foreground text-small flex items-center gap-2"
                    >{u.kind}{u.estimated ? ' (estimate)' : ''}{#if u.overdue}<Badge
                        variant="destructive">Overdue</Badge
                      >{/if}</span
                  >
                </span>
                <span class="text-body font-semibold tabular-nums">{inr(u.amount)}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <p class="text-muted-foreground text-small">
        Prices updated {data.pricesAsOf ? date(data.pricesAsOf) : 'never'} · As of {date(data.date)}
      </p>
    </div>
  </div>
{/if}
