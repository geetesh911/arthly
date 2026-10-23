<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import ChartPie from '@lucide/svelte/icons/chart-pie';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

  import { api } from '#lib/api.ts';
  import { app, attempt, say } from '#lib/app.svelte.ts';
  import AddMenu from '#lib/components/AddMenu.svelte';
  import { addInvestment, importFiles } from '#lib/components/Nav.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import { CLASS_NAMES, inr, inrSigned, pct, shortDate } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';
  import type { HoldingDto, PriceStatusDto } from '#lib/worker/dto.ts';

  let by = $state<'assetClass' | 'group' | 'account' | 'member'>('assetClass');
  let holdings = $state<HoldingDto[] | null>(null);
  let prices = $state<PriceStatusDto | null>(null);
  let refreshing = $state(false);

  $effect(() => {
    void app.version;
    void api()
      .holdings($state.snapshot(app.filter))
      .then((h) => (holdings = h));
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

  const sections = $derived.by(() => {
    const map: Record<string, HoldingDto[]> = {};

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
              : [h.memberName];

      for (const k of keys) {
        map[k] = [...(map[k] ?? []), h];
      }
    }

    return Object.entries(map)
      .map(([name, list]) => ({
        name,
        list: [...list].sort((a, b) => b.value - a.value),
        ...totals(list),
      }))
      .sort((a, b) => b.value - a.value);
  });

  /** The member and account, leaving out the one the list is grouped by. */
  const where = (h: HoldingDto) =>
    [by !== 'member' && h.memberName, by !== 'account' && h.accountLabel]
      .filter(Boolean)
      .join(' · ');

  const tone = (n: number) => (n > 0 ? 'text-gain' : n < 0 ? 'text-loss' : '');
  const xirr = (h: HoldingDto) => `${h.xirrEstimate ? '≈ ' : ''}${pct(h.xirr)}`;
</script>

<PageHeader title="Holdings" description={live && holdings?.length ? pricesLine : undefined}>
  {#snippet actions()}
    <NativeSelect bind:value={by} aria-label="Group holdings by" size="sm">
      <option value="assetClass">By asset class</option>
      <option value="group">By group</option>
      <option value="account">By account</option>
      <option value="member">By member</option>
    </NativeSelect>
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
  <div class="grid gap-4">
    <Skeleton class="h-48 rounded-4xl" />
    <Skeleton class="h-32 rounded-4xl" />
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
  <Card.Root size="sm">
    <Card.Content class="px-1 sm:px-3">
      <!-- Phones show each holding and its value; wider screens add a column for each figure. -->
      <Table.Root class="table-fixed">
        <Table.Header>
          <Table.Row
            class="hover:bg-transparent [&>th]:text-muted-foreground [&>th]:h-9 [&>th]:text-xs"
          >
            <Table.Head>Holding</Table.Head>
            <Table.Head class="hidden w-32 text-right lg:table-cell">Invested</Table.Head>
            <Table.Head class="w-36 text-right md:w-32">Value</Table.Head>
            <Table.Head class="hidden w-32 text-right md:table-cell">Gain</Table.Head>
            <Table.Head class="hidden w-24 text-right md:table-cell">XIRR</Table.Head>
          </Table.Row>
        </Table.Header>
        {#each sections as s (s.name)}
          <Table.Body class="border-b">
            <Table.Row class="bg-muted/50 hover:bg-muted/50 tabular-nums [&>td]:py-2">
              <Table.Head scope="rowgroup" class="h-10 truncate">
                {s.name}
                <span class="text-muted-foreground ml-1 text-xs font-normal"
                  >{pct(total.value ? s.value / total.value : null, 0)}</span
                >
              </Table.Head>
              <Table.Cell class="hidden text-right lg:table-cell">{inr(s.invested)}</Table.Cell>
              <Table.Cell class="text-right font-semibold">{inr(s.value)}</Table.Cell>
              <Table.Cell class={cn('hidden text-right md:table-cell', tone(s.gain))}
                >{inrSigned(s.gain)}</Table.Cell
              >
              <Table.Cell class="hidden md:table-cell"></Table.Cell>
            </Table.Row>
            {#each s.list as h (h.key)}
              <Table.Row class="relative tabular-nums [&>td]:align-top">
                <Table.Cell class="whitespace-normal">
                  <span class="flex min-w-0 items-center gap-2">
                    <a
                      href={`#/holdings/${encodeURIComponent(h.key)}`}
                      title={h.name}
                      class="focus-visible:after:ring-ring/50 line-clamp-2 font-medium wrap-anywhere outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
                      >{h.name}</a
                    >
                    {#if h.status === 'matured'}<Badge variant="secondary">Matured</Badge>{/if}
                  </span>
                  <span class="text-muted-foreground mt-0.5 block truncate text-xs">{where(h)}</span
                  >
                </Table.Cell>
                <Table.Cell class="hidden text-right lg:table-cell">{inr(h.invested)}</Table.Cell>
                <Table.Cell class="text-right">
                  <!-- The * sits in the padding, so the figures stay in line. -->
                  <span class="relative font-medium"
                    >{inr(h.value)}{#if h.estimate}<span class="absolute left-full">*</span
                      >{/if}</span
                  >
                  <span class="mt-0.5 block text-xs md:hidden">
                    <span class={tone(h.gain)}>{pct(h.gainPct, 2, true)}</span>
                    {#if h.xirr !== null}
                      <span class="text-muted-foreground block">XIRR {xirr(h)}</span>
                    {/if}
                  </span>
                </Table.Cell>
                <Table.Cell class={cn('hidden text-right md:table-cell', tone(h.gain))}>
                  {inrSigned(h.gain)}
                  <span class="mt-0.5 block text-xs">{pct(h.gainPct, 2, true)}</span>
                </Table.Cell>
                <Table.Cell class="hidden text-right md:table-cell">
                  {h.xirr === null ? '—' : xirr(h)}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        {/each}
        <Table.Footer class="bg-transparent tabular-nums">
          <Table.Row class="hover:bg-transparent [&>td]:align-top">
            <Table.Cell class="font-semibold">Total</Table.Cell>
            <Table.Cell class="hidden text-right lg:table-cell">{inr(total.invested)}</Table.Cell>
            <Table.Cell class="text-right font-semibold">
              {inr(total.value)}
              <span class={cn('mt-0.5 block text-xs font-medium md:hidden', tone(total.gain))}
                >{pct(total.gainPct, 2, true)}</span
              >
            </Table.Cell>
            <Table.Cell class={cn('hidden text-right md:table-cell', tone(total.gain))}>
              {inrSigned(total.gain)}
              <span class="mt-0.5 block text-xs">{pct(total.gainPct, 2, true)}</span>
            </Table.Cell>
            <Table.Cell class="hidden md:table-cell"></Table.Cell>
          </Table.Row>
        </Table.Footer>
      </Table.Root>
    </Card.Content>
  </Card.Root>
  {@const notes = [
    holdings.some((h) => h.xirr === null) && 'XIRR shows once a holding is a year old.',
    holdings.some((h) => h.xirrEstimate && h.xirr !== null) &&
      '≈ Counted from the holdings file’s date, as the file doesn’t say when you bought.',
    holdings.some((h) => h.xirrAsOf) && 'Fund XIRR is the one in your holdings file.',
    holdings.some((h) => h.estimate) && '* No market price yet; valued at cost or by its terms.',
  ].filter(Boolean)}
  {#if notes.length}<p class="text-muted-foreground text-xs">{notes.join(' ')}</p>{/if}
{/if}
