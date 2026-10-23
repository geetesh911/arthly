<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { scaleUtc } from 'd3-scale';
  import { AreaChart } from 'layerchart';
  import * as Chart from '#lib/components/ui/chart/index.ts';
  import { date, inr, inrShort } from '#lib/format.ts';
  import type { Point } from '#lib/worker/dto.ts';

  let { points }: { points: Point[] } = $props();

  const data = $derived(
    points.map((p) => ({
      date: new Date(`${p.date}T00:00:00Z`),
      value: p.value,
      invested: p.netInvested,
    })),
  );
  // Over two months the axis shows months; within them, days.
  const long = $derived(
    points.length > 1 &&
      Date.parse(points.at(-1)!.date) - Date.parse(points[0]!.date) > 62 * 86_400_000,
  );
  const tick = (d: Date) =>
    d.toLocaleDateString('en-IN', {
      month: 'short',
      ...(long ? {} : { day: 'numeric' }),
      timeZone: 'UTC',
    });

  const config = {
    value: { label: 'Value', color: 'var(--chart-1)' },
    invested: { label: 'Invested', color: 'var(--muted-foreground)' },
  } satisfies Chart.ChartConfig;
</script>

{#if points.length < 2}
  <p class="text-muted-foreground text-sm">
    The chart appears once there's more than a day of history.
  </p>
{:else}
  <Chart.Container {config} class="aspect-auto h-52 w-full">
    <AreaChart
      {data}
      x="date"
      xScale={scaleUtc()}
      series={[
        {
          key: 'value',
          label: 'Value',
          color: config.value.color,
          props: { 'fill-opacity': 0.18, line: { class: 'stroke-2' } },
        },
        {
          key: 'invested',
          label: 'Invested',
          color: config.invested.color,
          props: { fill: 'none', line: { 'stroke-dasharray': '4 4', class: 'stroke-1' } },
        },
      ]}
      seriesLayout="overlap"
      padding={{ left: 48, bottom: 24, top: 8, right: 8 }}
      props={{
        xAxis: { format: tick, ticks: 4 },
        yAxis: { format: inrShort, ticks: 4 },
      }}
    >
      {#snippet tooltip()}
        <Chart.Tooltip labelFormatter={(d: Date) => date(d.toISOString())} indicator="line">
          {#snippet formatter({ name, value, item })}
            <div class="flex w-full items-center gap-2">
              <span class="h-3 w-1 shrink-0 rounded-full" style:background={item.color}></span>
              <span class="text-muted-foreground flex-1">{name}</span>
              <span class="font-medium tabular-nums">{inr(value as number)}</span>
            </div>
          {/snippet}
        </Chart.Tooltip>
      {/snippet}
    </AreaChart>
  </Chart.Container>
{/if}
