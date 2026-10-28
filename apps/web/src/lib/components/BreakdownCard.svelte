<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- One breakdown as a flat section: a stacked bar with amounts, then what it covers. -->
<script lang="ts">
  import type { Breakdown } from '@pv/core';

  import { inr, pct } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';

  import StackedBar from './StackedBar.svelte';

  let {
    title,
    description,
    data,
    note,
    coverage = false,
    estimated = 0,
    labels = {},
    heading = true,
    class: className,
  }: {
    title: string;
    description: string;
    data: Breakdown;
    note?: string;
    coverage?: boolean;
    /** Value placed by fund type rather than from a holdings report. */
    estimated?: number;
    labels?: Record<string, string>;
    /** Off where something around it already names it, such as a row on Insights. */
    heading?: boolean;
    class?: string;
  } = $props();
  const slices = $derived(
    data.slices.map((s) => [labels[s.label] ?? s.label, s.value] as [string, number]),
  );
</script>

<section
  aria-label={heading ? title : undefined}
  class={cn('grid grid-cols-1 content-start gap-3', className)}
>
  <div class="grid gap-0.5">
    {#if heading}<h2 class="text-title font-semibold">{title}</h2>{/if}
    <p class="text-muted-foreground text-small">{description}</p>
  </div>
  {#if data.total > 0}
    <StackedBar {slices} legend="list" label={title} />
    <div class="text-muted-foreground text-small flex flex-wrap justify-between gap-2">
      <span>Included value {inr(data.total)}</span>
      {#if coverage}<span>{pct(data.classified / data.total, 0)} classified</span>{/if}
      {#if estimated > 0}<span>{pct(estimated / data.total, 0)} by fund type</span>{/if}
    </div>
  {:else}
    <p class="text-muted-foreground text-body py-2">No applicable holdings in this selection.</p>
  {/if}
  {#if note}<p class="text-muted-foreground text-small">{note}</p>{/if}
</section>
