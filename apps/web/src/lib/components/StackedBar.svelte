<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- A share of a whole as one bar, largest first, in place of a donut: easier to read on a phone.
     The key below is either a two-column `grid` of shares, or a `list` with amounts. -->
<script lang="ts">
  import { inrShort, pct } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';

  let {
    slices,
    legend = 'grid',
    label = 'Share',
  }: {
    slices: [string, number][];
    legend?: 'grid' | 'list' | 'none';
    /** Names the bar for screen readers, ahead of its shares. */
    label?: string;
  } = $props();

  const total = $derived(slices.reduce((s, [, v]) => s + Math.max(0, v), 0));
  const parts = $derived(
    slices
      .filter(([, v]) => v > 0)
      .map(([name, value], i) => ({
        name,
        value,
        share: total > 0 ? value / total : 0,
        color: `var(--chart-${(i % 7) + 1})`,
      })),
  );
  const aria = $derived(`${label}: ${parts.map((p) => `${p.name} ${pct(p.share, 0)}`).join(', ')}`);
</script>

<div class="grid grid-cols-1 gap-3">
  <div role="img" aria-label={aria} class="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
    {#each parts as p (p.name)}
      <span class="h-full min-w-1" style:flex-grow={p.share} style:background={p.color}></span>
    {/each}
  </div>
  {#if legend === 'grid'}
    <ul class="text-body grid grid-cols-2 gap-x-6 gap-y-2">
      {#each parts as p (p.name)}
        <li class="flex min-w-0 items-center gap-2">
          <span class="size-2 shrink-0 rounded-full" style:background={p.color}></span>
          <span class="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
          <span class="text-muted-foreground tabular-nums">{pct(p.share, 0)}</span>
        </li>
      {/each}
    </ul>
  {:else if legend === 'list'}
    <ul class="grid grid-cols-1">
      {#each parts as p, i (p.name)}
        <li class={cn('flex min-h-11 items-center gap-3', i > 0 && 'border-t')}>
          <span class="size-2 shrink-0 rounded-full" style:background={p.color}></span>
          <span class="text-body min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
          <span class="text-muted-foreground text-small tabular-nums">{inrShort(p.value)}</span>
          <span class="text-body w-11 text-right font-semibold tabular-nums">{pct(p.share, 0)}</span
          >
        </li>
      {/each}
    </ul>
  {/if}
</div>
