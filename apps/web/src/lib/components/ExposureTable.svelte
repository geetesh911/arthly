<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Concentration } from '@pv/core';

  import { inr, inrSigned, pct } from '#lib/format.ts';

  import * as Table from './ui/table/index.ts';
  import Stat from './Stat.svelte';
  let { data, stocks = false }: { data: Concentration; stocks?: boolean } = $props();
</script>

{#if data.count === 0}
  <p class="text-muted-foreground text-sm">
    {stocks
      ? 'No identified stocks in this selection. Fund disclosures may be missing.'
      : 'No holdings in this selection.'}
  </p>
{:else}
  <div class="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
    <Stat label={stocks ? 'Unique stocks' : 'Unique holdings'} value={String(data.count)} />
    <Stat label="Largest position" value={pct(data.top1, 1)} />
    <Stat label="Top 5 positions" value={pct(data.top5, 1)} />
    <Stat label="Effective positions" value={data.effectiveCount?.toFixed(1) ?? '—'} />
  </div>
  <Table.Root class="table-fixed sm:table-auto">
    <Table.Header
      ><Table.Row>
        <Table.Head class="w-2/5 sm:w-auto">Holding</Table.Head>
        <Table.Head class="text-right whitespace-normal">Value / weight</Table.Head>
        <Table.Head class="text-right whitespace-normal"
          >{stocks ? 'Direct / via funds' : 'Gain'}</Table.Head
        >
      </Table.Row></Table.Header
    >
    <Table.Body>
      {#each data.rows.slice(0, 10) as row (row.key)}
        <Table.Row>
          <Table.Cell class="max-w-64 whitespace-normal">
            <span class="line-clamp-2 font-medium">{row.name}</span>
            {#if stocks}<span class="text-muted-foreground text-xs"
                >{pct(row.portfolioShare, 1)} of portfolio</span
              >{/if}
          </Table.Cell>
          <Table.Cell class="text-right whitespace-normal tabular-nums">
            {inr(row.value)}<span class="text-muted-foreground block text-xs"
              >{pct(row.share, 1)}</span
            >
          </Table.Cell>
          <Table.Cell class="text-right whitespace-normal tabular-nums">
            {#if stocks}
              <span class="block text-xs">Direct {inr(row.directValue ?? 0)}</span>
              <span class="text-muted-foreground block text-xs"
                >Funds {inr(row.indirectValue ?? 0)}</span
              >
            {:else}{inrSigned(row.gain)}{/if}
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
  <p class="text-muted-foreground mt-3 text-xs leading-relaxed">
    {data.count > 10 ? 'Showing the largest 10. ' : ''}Weights use {stocks
      ? 'identified direct and underlying stock value'
      : 'total portfolio value'}. Effective positions = 1 / sum of squared weights; a lower number
    means more concentrated holdings.
  </p>
{/if}
