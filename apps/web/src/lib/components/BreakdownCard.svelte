<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Breakdown } from '@pv/core';

  import { inr, pct } from '#lib/format.ts';

  import * as Card from './ui/card/index.ts';
  import Donut from './Donut.svelte';

  let {
    title,
    description,
    data,
    note,
    coverage = false,
    estimated = 0,
    labels = {},
  }: {
    title: string;
    description: string;
    data: Breakdown;
    note?: string;
    coverage?: boolean;
    /** Value placed by fund type rather than from a holdings report. */
    estimated?: number;
    labels?: Record<string, string>;
  } = $props();
  const slices = $derived(
    data.slices.map((s) => [labels[s.label] ?? s.label, s.value] as [string, number]),
  );
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">{title}</Card.Title>
    <Card.Description>{description}</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if data.total > 0}
      <Donut {slices} />
      <div class="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
        <span>Included value {inr(data.total)}</span>
        {#if coverage}<span>{pct(data.classified / data.total, 0)} classified</span>{/if}
        {#if estimated > 0}<span>{pct(estimated / data.total, 0)} by fund type</span>{/if}
      </div>
    {:else}
      <p class="text-muted-foreground py-4 text-sm">No applicable holdings in this selection.</p>
    {/if}
    {#if note}<p class="text-muted-foreground text-xs leading-relaxed">{note}</p>{/if}
  </Card.Content>
</Card.Root>
