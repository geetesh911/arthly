<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script module lang="ts">
  type Metric = 'current' | 'returns' | 'xirr' | 'share';
  type Sort = 'value' | 'returns' | 'xirr' | 'name';
  type By = 'assetClass' | 'group' | 'account' | 'member' | 'none';

  // Kept while the app is open, so Holdings looks the same on coming back to it.
  const view = $state<{ metric: Metric; sort: Sort; by: By }>({
    metric: 'current',
    sort: 'value',
    by: 'assetClass',
  });
</script>

<script lang="ts">
  import ChartPie from '@lucide/svelte/icons/chart-pie';
  import Check from '@lucide/svelte/icons/check';
  import ChevronsLeftRight from '@lucide/svelte/icons/chevrons-left-right';
  import Info from '@lucide/svelte/icons/info';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

  import { api } from '#lib/api.ts';
  import { app, attempt, say } from '#lib/app.svelte.ts';
  import AddMenu from '#lib/components/AddMenu.svelte';
  import BottomSheet from '#lib/components/BottomSheet.svelte';
  import { addInvestment, importFiles } from '#lib/components/Nav.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import { CLASS_NAMES, inr, inrShort, inrSigned, pct, shortDate } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';
  import type { HoldingDto, OverviewDto, PriceStatusDto } from '#lib/worker/dto.ts';

  let holdings = $state<HoldingDto[] | null>(null);
  let overview = $state<OverviewDto | null>(null);
  let prices = $state<PriceStatusDto | null>(null);
  let refreshing = $state(false);
  let sorting = $state(false);

  $effect(() => {
    void app.version;
    const filter = $state.snapshot(app.filter);

    void api()
      .holdings(filter)
      .then((h) => (holdings = h));
    // For the XIRR of everything held, as Home counts it.
    void api()
      .overview(filter, '1m')
      .then((o) => (overview = o));
    void api()
      .priceStatus()
      .then((s) => (prices = s));
  });

  async function refresh() {
    refreshing = true;
    const result = await attempt(() => api().refreshPrices(true));

    refreshing = false;

    if (result) {
      say(result.ok ? 'Prices updated' : (result.message ?? ''));
    }

    app.version += 1;
  }

  // Sample data has made-up prices, so there's nothing to refresh.
  const live = $derived(!app.vault?.demo);
  const pricesLine = $derived.by(() => {
    const parts = [
      prices?.funds && `funds ${shortDate(prices.funds)}`,
      prices?.stocks && `stocks ${shortDate(prices.stocks)}`,
    ].filter(Boolean);

    return parts.length ? `Prices: ${parts.join(' · ')}` : 'No market prices yet';
  });

  function totals(list: HoldingDto[]) {
    const value = list.reduce((s, h) => s + h.value, 0);
    const invested = list.reduce((s, h) => s + h.invested, 0);
    const gain = list.reduce((s, h) => s + h.gain, 0);

    return { value, invested, gain, gainPct: invested > 0 ? gain / invested : null };
  }

  // Counts each holding once, though a holding can be in more than one group.
  const total = $derived(totals(holdings ?? []));
  // XIRR needs a year of history, as on Home.
  const young = $derived(
    !overview?.firstFlow || Date.now() - Date.parse(overview.firstFlow) < 365 * 86_400_000,
  );

  // Tapping the column's name moves to the next figure, as Groww and Kite do.
  const metrics: { key: Metric; label: string }[] = [
    { key: 'current', label: 'Current (Invested)' },
    { key: 'returns', label: 'Returns (%)' },
    { key: 'xirr', label: 'XIRR' },
    { key: 'share', label: 'Share (Current)' },
  ];
  const at = $derived(metrics.findIndex((m) => m.key === view.metric));
  const metric = $derived(metrics[at]!);
  const nextMetric = $derived(metrics[(at + 1) % metrics.length]!);

  const sorts: { key: Sort; label: string; hint: string }[] = [
    { key: 'value', label: 'Current value', hint: 'Largest first' },
    { key: 'returns', label: 'Returns', hint: 'Best first' },
    { key: 'xirr', label: 'XIRR', hint: 'Best first' },
    { key: 'name', label: 'Name', hint: 'A to Z' },
  ];
  const order: Record<Sort, (a: HoldingDto, b: HoldingDto) => number> = {
    value: (a, b) => b.value - a.value,
    returns: (a, b) => (b.gainPct ?? -Infinity) - (a.gainPct ?? -Infinity),
    xirr: (a, b) => (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const groupings = $derived(
    [
      { key: 'assetClass' as const, label: 'Asset class' },
      new Set(holdings?.map((h) => h.memberId)).size > 1 && {
        key: 'member' as const,
        label: 'Member',
      },
      { key: 'account' as const, label: 'Account' },
      holdings?.some((h) => h.groups.length) && { key: 'group' as const, label: 'Group' },
      { key: 'none' as const, label: 'None' },
    ].filter((g): g is { key: By; label: string } => !!g),
  );

  const sections = $derived.by(() => {
    const map: Record<string, HoldingDto[]> = {};
    const by = view.by;

    for (const h of holdings ?? []) {
      const keys =
        by === 'assetClass'
          ? [CLASS_NAMES[h.assetClass] ?? h.assetClass]
          : by === 'group'
            ? h.groups.length
              ? h.groups
              : ['Not in a group']
            : by === 'account'
              ? [h.accountLabel]
              : by === 'member'
                ? [h.memberName]
                : [''];

      for (const k of keys) {
        map[k] = [...(map[k] ?? []), h];
      }
    }

    return Object.entries(map)
      .map(([name, list]) => ({
        name,
        list: [...list].sort(order[view.sort]),
        ...totals(list),
      }))
      .sort((a, b) => b.value - a.value);
  });

  /** The member and account, leaving out the one the list is grouped by. */
  const where = (h: HoldingDto) =>
    [view.by !== 'member' && h.memberName, view.by !== 'account' && h.accountLabel]
      .filter(Boolean)
      .join(' · ');

  const notes = $derived(
    [
      'Gain is today’s value less what you put in.',
      'Tap the name above the figures to switch between current value, returns, XIRR and share.',
      holdings?.some((h) => h.xirr === null) && 'XIRR shows once a holding is a year old.',
      holdings?.some((h) => h.xirrEstimate && h.xirr !== null) &&
        '≈ Counted from the holdings file’s date, as the file doesn’t say when you bought.',
      holdings?.some((h) => h.xirrAsOf) && 'Fund XIRR is the one in your holdings file.',
      holdings?.some((h) => h.xirrTo) && 'EPF and PPF XIRR runs to the last interest credit.',
      holdings?.some((h) => h.estimate) && '* No market price yet; valued at cost or by its terms.',
    ].filter((n): n is string => !!n),
  );

  const tone = (n: number) => (n > 0 ? 'text-gain' : n < 0 ? 'text-loss' : 'text-muted-foreground');
  const xirr = (h: HoldingDto) =>
    h.xirr === null ? '—' : `${h.xirrEstimate ? '≈ ' : ''}${pct(h.xirr)}`;
  /** Under the XIRR: what it runs to, or why there's none yet. */
  const xirrNote = (h: HoldingDto) =>
    h.xirr === null
      ? 'Under a year'
      : h.xirrAsOf
        ? 'From your file'
        : h.xirrTo
          ? `To ${shortDate(h.xirrTo)}`
          : 'A year';
</script>

<!-- What a phone shows on the right of a row: the figure the column's name picks. -->
{#snippet figure(h: HoldingDto)}
  {#if view.metric === 'current'}
    <span class="text-body relative font-semibold"
      >{inr(h.value)}{#if h.estimate}<span class="absolute left-full">*</span>{/if}</span
    >
    <span class="text-muted-foreground text-small">{inr(h.invested)}</span>
  {:else if view.metric === 'returns'}
    <span class={cn('text-body font-semibold', tone(h.gain))}>{inrSigned(h.gain)}</span>
    <span class={cn('text-small', tone(h.gain))}>{pct(h.gainPct, 2, true)}</span>
  {:else if view.metric === 'xirr'}
    <span class={cn('text-body font-semibold', h.xirr === null && 'text-muted-foreground')}
      >{xirr(h)}</span
    >
    <span class="text-muted-foreground text-small">{xirrNote(h)}</span>
  {:else}
    <span class="text-body font-semibold">{pct(h.weight, 1)}</span>
    <span class="text-muted-foreground text-small">{inr(h.value)}</span>
  {/if}
{/snippet}

<!-- Wide screens have room for every figure, each in its own column. -->
{#snippet column(top: string, bottom: string, topClass = '', bottomClass = 'text-muted-foreground')}
  <span class="hidden w-28 shrink-0 flex-col items-end gap-0.5 md:flex">
    <span class={cn('text-body', topClass)}>{top}</span>
    <span class={cn('text-small', bottomClass)}>{bottom}</span>
  </span>
{/snippet}

<PageHeader title="Holdings" description={live && holdings?.length ? pricesLine : undefined}>
  {#snippet actions()}
    {#if live}
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Refresh prices"
        title="Refresh prices"
        disabled={refreshing}
        onclick={refresh}><RefreshCw class={cn(refreshing && 'animate-spin')} /></Button
      >
    {/if}
    <AddMenu groups={[{ links: [importFiles] }, addInvestment]} size="sm" align="end" />
  {/snippet}
</PageHeader>

{#if !holdings}
  <div class="grid gap-6">
    <Skeleton class="h-48 rounded-2xl" />
    <Skeleton class="h-64 rounded-2xl" />
  </div>
{:else if holdings.length === 0}
  <Empty.Root class="min-h-[50dvh]">
    <Empty.Header>
      <Empty.Media variant="icon"><ChartPie /></Empty.Media>
      <Empty.Title>No holdings yet</Empty.Title>
      <Empty.Description>Import a file or add an FD, PPF or EPF by hand.</Empty.Description>
    </Empty.Header>
    <Empty.Content><Button href="#/import">Import files</Button></Empty.Content>
  </Empty.Root>
{:else}
  <!-- One column that can't grow past the screen, so long names truncate instead. -->
  <div class="grid grid-cols-1 gap-6">
    <section aria-label="Total" class="bg-card grid gap-4 rounded-2xl border p-4 lg:max-w-md">
      <div class="grid gap-1">
        <span class="text-muted-foreground text-small"
          >Current value · {holdings.length}
          {holdings.length === 1 ? 'holding' : 'holdings'}</span
        >
        <span class="text-headline font-semibold tabular-nums" data-testid="holdings-value"
          >{inr(total.value)}</span
        >
      </div>
      <dl class="text-body grid gap-3 border-t border-dashed pt-4 tabular-nums">
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-muted-foreground">Total returns</dt>
          <dd class={cn('font-semibold', tone(total.gain))}>
            <span data-testid="holdings-gain">{inrSigned(total.gain)}</span>
            ({pct(total.gainPct, 2, true)})
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-muted-foreground">Invested</dt>
          <dd class="font-semibold" data-testid="holdings-invested">{inr(total.invested)}</dd>
        </div>
        {#if overview && !young}
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">XIRR</dt>
            <dd class="font-semibold">
              {overview.xirrEstimate ? '≈ ' : ''}{pct(overview.xirr)}
            </dd>
          </div>
        {/if}
      </dl>
    </section>

    <div class="grid grid-cols-1">
      <div class="flex items-center justify-between gap-3 border-b pb-1">
        <BottomSheet title="Sort and group" bind:open={sorting}>
          {#snippet trigger(props)}
            <button
              {...props}
              type="button"
              class="text-muted-foreground hover:text-foreground text-small -ml-2 flex min-h-11 items-center gap-2 px-2 font-semibold"
              ><ListFilter class="size-5" /><span class="sr-only">Sort and group, sorted by</span
              >{sorts.find((s) => s.key === view.sort)?.label}</button
            >
          {/snippet}
          <div class="grid gap-6">
            <section aria-labelledby="sort-by" class="grid">
              <h3 id="sort-by" class="text-muted-foreground text-small pb-1">Sort by</h3>
              {#each sorts as s (s.key)}
                <button
                  type="button"
                  aria-pressed={view.sort === s.key}
                  onclick={() => (view.sort = s.key)}
                  class="flex min-h-12 items-center gap-3 border-b text-left last:border-b-0"
                >
                  <span class="text-body flex-1">{s.label}</span>
                  <span class="text-muted-foreground text-small">{s.hint}</span>
                  <Check class={cn('size-4.5', view.sort !== s.key && 'invisible')} />
                </button>
              {/each}
            </section>
            <section aria-labelledby="group-by" class="grid gap-2">
              <h3 id="group-by" class="text-muted-foreground text-small">Group by</h3>
              <div class="flex flex-wrap gap-2">
                {#each groupings as g (g.key)}
                  <button
                    type="button"
                    aria-pressed={view.by === g.key}
                    onclick={() => (view.by = g.key)}
                    class={cn(
                      'text-small h-9 rounded-full border px-3.5 font-semibold transition-colors',
                      view.by === g.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input hover:bg-muted',
                    )}>{g.label}</button
                  >
                {/each}
              </div>
            </section>
            <Button size="lg" class="h-12 w-full" onclick={() => (sorting = false)}>Done</Button>
          </div>
        </BottomSheet>

        <button
          type="button"
          onclick={() => (view.metric = nextMetric.key)}
          class="text-small flex min-h-11 min-w-44 items-center justify-end gap-1.5 font-semibold md:hidden"
        >
          <ChevronsLeftRight class="text-muted-foreground size-4" />
          <span class="sr-only">Showing</span>
          <span class="decoration-muted-foreground underline decoration-dashed underline-offset-4"
            >{metric.label}</span
          >
          <span class="sr-only">. Show {nextMetric.label} instead</span>
        </button>
        <div
          aria-hidden="true"
          class="text-muted-foreground text-small hidden items-center gap-4 md:flex"
        >
          <span class="w-28 text-right">Invested</span>
          <span class="w-28 text-right">Current</span>
          <span class="w-28 text-right">Returns</span>
          <span class="w-28 text-right">XIRR</span>
        </div>
      </div>

      {#each sections as s (s.name)}
        <section aria-label={s.name || 'All holdings'} class="grid grid-cols-1">
          {#if view.by !== 'none'}
            <div class="flex items-baseline justify-between gap-3 pt-5 pb-2">
              <h2 class="text-body truncate font-semibold">{s.name}</h2>
              <span class="text-small shrink-0 tabular-nums">
                {#if view.metric === 'returns'}
                  <span class={tone(s.gain)}>{inrSigned(s.gain)} · {pct(s.gainPct, 1, true)}</span>
                {:else}
                  <span class="text-muted-foreground"
                    >{inrShort(s.value)} · {pct(
                      total.value ? s.value / total.value : null,
                      0,
                    )}</span
                  >
                {/if}
              </span>
            </div>
          {/if}
          {#each s.list as h (h.key)}
            <a
              href={`#/holdings/${encodeURIComponent(h.key)}`}
              title={h.name}
              class="hover:bg-muted/60 -mx-2 flex items-start gap-4 rounded-xl border-t px-2 py-3.5 tabular-nums transition-colors first:border-t-0"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-body line-clamp-2 font-semibold wrap-anywhere"
                  >{h.name}{#if h.status === 'matured'}
                    <Badge variant="secondary" class="ml-1 align-middle">Matured</Badge>{/if}</span
                >
                <span class="text-muted-foreground text-small truncate">{where(h)}</span>
              </span>
              <span class="flex shrink-0 flex-col items-end gap-0.5 md:hidden">
                {@render figure(h)}
              </span>
              {@render column(inr(h.invested), '')}
              {@render column(
                inr(h.value) + (h.estimate ? ' *' : ''),
                pct(h.weight, 1),
                'font-semibold',
              )}
              {@render column(
                inrSigned(h.gain),
                pct(h.gainPct, 2, true),
                tone(h.gain),
                tone(h.gain),
              )}
              {@render column(xirr(h), xirrNote(h))}
            </a>
          {/each}
        </section>
      {/each}
    </div>

    <BottomSheet title="How these figures work">
      {#snippet trigger(props)}
        <button
          {...props}
          type="button"
          class="text-muted-foreground text-small flex min-h-11 items-center gap-2 justify-self-start"
          ><Info class="size-4" />How these figures work</button
        >
      {/snippet}
      <ul class="text-body grid list-disc gap-2 pl-5">
        {#each notes as n (n)}<li>{n}</li>{/each}
      </ul>
    </BottomSheet>
  </div>
{/if}
