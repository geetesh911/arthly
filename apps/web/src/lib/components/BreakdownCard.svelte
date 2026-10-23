<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Breakdown } from '@pv/core';

  import { inr, pct } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';

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
    wide = false,
  }: {
    title: string;
    description: string;
    data: Breakdown;
    note?: string;
    coverage?: boolean;
    /** Value placed by fund type rather than from a holdings report. */
    estimated?: number;
    labels?: Record<string, string>;
    /** Spans both columns on wide screens, with the note beside the chart on the widest. */
    wide?: boolean;
  } = $props();
  const slices = $derived(
    data.slices.map((s) => [labels[s.label] ?? s.label, s.value] as [string, number]),
  );
</script>

<!-- Cards in a row share its height, so the notes line up at the bottom. -->
<Card.Root class={cn(wide && 'lg:col-span-2')}>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">{title}</Card.Title>
    <Card.Description>{description}</Card.Description>
  </Card.Header>
  <Card.Content
    class={cn(
      'flex flex-1 flex-col gap-4',
      wide && 'xl:grid xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] xl:items-center xl:gap-x-12',
    )}
  >
    {#if data.total > 0}
      <div class="grid gap-4">
        <Donut {slices} />
        <div class="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
          <span>Included value {inr(data.total)}</span>
          {#if coverage}<span>{pct(data.classified / data.total, 0)} classified</span>{/if}
          {#if estimated > 0}<span>{pct(estimated / data.total, 0)} by fund type</span>{/if}
        </div>
      </div>
    {:else}
      <p class="text-muted-foreground py-4 text-sm">No applicable holdings in this selection.</p>
    {/if}
    {#if note}<p
        class={cn('text-muted-foreground mt-auto text-xs leading-relaxed', wide && 'xl:mt-0')}
      >
        {note}
      </p>{/if}
  </Card.Content>
</Card.Root>
