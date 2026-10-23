<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { PieChart } from 'layerchart';
  import * as Chart from '#lib/components/ui/chart/index.ts';
  import { inr, inrShort, pct } from '#lib/format.ts';

  let { slices }: { slices: [string, number][] } = $props();

  const total = $derived(slices.reduce((s, [, v]) => s + Math.max(0, v), 0));
  // Keys are indexes, since labels such as "Not in a group" can't be CSS names.
  const arcs = $derived(
    slices
      .filter(([, v]) => v > 0)
      .map(([label, value], i) => ({
        key: `s${i}`,
        label,
        value,
        share: total > 0 ? value / total : 0,
        color: `var(--chart-${(i % 7) + 1})`,
      })),
  );
  const config = $derived(
    Object.fromEntries(
      arcs.map((a) => [a.key, { label: a.label, color: a.color }]),
    ) satisfies Chart.ChartConfig,
  );
</script>

<!-- Side by side only when the card itself is wide enough, not the screen. -->
<div class="@container">
  <div class="flex flex-col items-center gap-6 @lg:flex-row">
    <div role="img" aria-label="Allocation" class="shrink-0">
      <Chart.Container {config} class="aspect-square h-40 w-40">
        <PieChart
          data={arcs}
          key="key"
          label="label"
          value="value"
          c="color"
          innerRadius={0.62}
          padAngle={0.02}
          cornerRadius={4}
        >
          {#snippet tooltip()}
            <Chart.Tooltip hideLabel>
              {#snippet formatter({ name, value, item })}
                <div class="flex w-full items-center gap-2">
                  <span class="size-2.5 shrink-0 rounded-full" style:background={item.color}></span>
                  <span class="text-muted-foreground flex-1">{name}</span>
                  <span class="font-medium tabular-nums">{inr(value as number)}</span>
                </div>
              {/snippet}
            </Chart.Tooltip>
          {/snippet}
        </PieChart>
      </Chart.Container>
    </div>
    <ul class="w-full min-w-0 flex-1 space-y-2 text-sm">
      {#each arcs as a (a.key)}
        <li class="flex items-center gap-3">
          <span class="size-2.5 shrink-0 rounded-full" style:background={a.color}></span>
          <span class="min-w-0 flex-1 truncate" title={a.label}>{a.label}</span>
          <span class="tabular-nums">{inrShort(a.value)}</span>
          <span class="text-muted-foreground w-10 text-right tabular-nums">{pct(a.share, 0)}</span>
        </li>
      {/each}
    </ul>
  </div>
</div>
