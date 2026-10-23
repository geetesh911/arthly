<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { BenchmarkRow, Benchmarks, ReturnBasis } from '@pv/core';
  import { date, pct } from '#lib/format.ts';
  import { Badge } from './ui/badge/index.ts';
  import { Button } from './ui/button/index.ts';
  import * as Card from './ui/card/index.ts';
  import { Input } from './ui/input/index.ts';
  import * as Table from './ui/table/index.ts';

  let { data }: { data: Benchmarks } = $props();
  let query = $state('');
  let showAll = $state(false);

  const BASIS: Record<ReturnBasis, string> = {
    price: 'Price',
    total: 'Total return',
    'net-total': 'Net total return',
    volatility: 'Volatility',
    unknown: 'Basis not stated',
  };
  const level = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const tone = (n: number | undefined) =>
    n === undefined ? '' : n > 0 ? 'text-gain' : n < 0 ? 'text-loss' : '';

  const matches = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return data.rows.filter((r) =>
      words.every((w) => `${r.name} ${r.provider}`.toLowerCase().includes(w)),
    );
  });
  const rows = $derived(showAll || query ? matches : matches.slice(0, 12));
  const since = $derived(
    data.rows.reduce<string | undefined>((a, r) => (!a || r.since < a ? r.since : a), undefined),
  );
  const changeTitle = (r: BenchmarkRow, period: string) =>
    r.basis === 'volatility' || r.basis === 'unknown'
      ? 'Not shown for this kind of index'
      : `No saved close from about a ${period} ago`;
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Indices and benchmarks</Card.Title>
    <Card.Description>Every index in NSE’s and BSE’s daily files.</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if !data.sources.length}
      <p class="text-muted-foreground text-sm">Refresh data to load index levels.</p>
    {:else}
      <ul class="grid gap-1 text-sm">
        {#each data.sources as s (s.provider)}
          <li class="break-words">
            <span class="font-medium">{s.label}:</span>
            {#if s.date}
              <span class="text-muted-foreground"
                >{s.count}
                {s.count === 1 ? 'index' : 'indices'}, {date(s.date)} ·
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline underline-offset-4">Official file</a
                ></span
              >
            {/if}
            {#if s.failure}
              <span class="text-muted-foreground block text-xs"
                >Couldn’t refresh ({s.failure}).{s.date
                  ? ` Showing levels from ${date(s.date)}.`
                  : ''}</span
              >
            {/if}
          </li>
        {/each}
      </ul>
      {#if data.rows.length}
        <Input
          type="search"
          aria-label="Search indices"
          placeholder="Search NSE and BSE indices"
          bind:value={query}
        />
        <Table.Root class="table-fixed sm:table-auto">
          <Table.Header
            ><Table.Row
              ><Table.Head class="w-[44%] sm:w-auto">Index</Table.Head><Table.Head
                class="text-right whitespace-normal">Level / day</Table.Head
              ><Table.Head class="text-right whitespace-normal">1 month / 1 year</Table.Head
              ></Table.Row
            ></Table.Header
          >
          <Table.Body>
            {#each rows as r (r.id)}
              <Table.Row>
                <Table.Cell class="max-w-72 whitespace-normal">
                  <span class="line-clamp-2 font-medium">{r.name}</span>
                  <span class="text-muted-foreground block text-xs"
                    >{r.provider.toUpperCase()} · {BASIS[r.basis]}{r.currency === 'USD'
                      ? ' · in US dollars'
                      : ''}</span
                  >
                  {#if r.members}<span class="text-muted-foreground block text-xs"
                      >{r.members} members listed, weights not published</span
                    >{/if}
                  {#if r.retained}<Badge variant="outline" class="mt-1 whitespace-normal"
                      >Not in the latest file; level from {date(r.date)}</Badge
                    >{/if}
                </Table.Cell>
                <Table.Cell class="text-right whitespace-normal tabular-nums">
                  <span class="block">{level.format(r.close)}</span>
                  <span class={['block text-xs', tone(r.changeRatio)]}
                    >{pct(r.changeRatio, 2, true)}</span
                  >
                </Table.Cell>
                <Table.Cell class="text-right whitespace-normal tabular-nums">
                  <span
                    class={['block', tone(r.month)]}
                    title={r.month === undefined ? changeTitle(r, 'month') : undefined}
                    >{pct(r.month, 1, true)}</span
                  >
                  <span
                    class={['block', tone(r.year)]}
                    title={r.year === undefined ? changeTitle(r, 'year') : undefined}
                    >{pct(r.year, 1, true)}</span
                  >
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
        {#if !matches.length}<p class="text-muted-foreground text-sm">No matching indices.</p>{/if}
        {#if !query && matches.length > 12}<Button
            variant="outline"
            size="sm"
            class="justify-self-start"
            onclick={() => (showAll = !showAll)}
            >{showAll ? 'Show main indices' : `Show all ${matches.length} indices`}</Button
          >{/if}
        <div class="text-muted-foreground grid gap-2 text-xs leading-relaxed">
          <p>
            Saved closes start {date(since)}. 1 month and 1 year changes appear once they reach back
            that far; a fresh start doesn’t bring an index’s past.
          </p>
          <p>
            Equity levels are price indices, so dividends aren’t included; these files don’t carry
            total return versions. Changes are from one close to another and leave out your own cash
            flows, so they can’t be compared directly with your XIRR.
          </p>
          {#if data.warnings.length}
            <p>
              Left out of the latest files: {data.warnings.slice(0, 3).join('; ')}{data.warnings
                .length > 3
                ? ` (and ${data.warnings.length - 3} more)`
                : ''}.
            </p>
          {/if}
        </div>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>
