<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { ASSET_CLASSES, rebalancePlan, type AllocationTargets } from '@pv/core';
  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import { CLASS_NAMES, inr, inrSigned, pct } from '#lib/format.ts';
  import { Button } from './ui/button/index.ts';
  import * as Card from './ui/card/index.ts';
  import { Input } from './ui/input/index.ts';

  let {
    current,
    saved,
    memberId,
  }: { current: AllocationTargets; saved: AllocationTargets | null; memberId?: string } = $props();
  let targets = $state<AllocationTargets>({});
  let contribution = $state(0);
  let saving = $state(false);
  let message = $state('');
  let error = $state('');
  $effect(() => {
    // Changing member or refreshing holdings resets the scenario to its saved targets.
    void memberId;
    const total = Object.values(current).reduce((n, v) => n + v, 0);
    const initial: AllocationTargets = {};
    for (const cls of ASSET_CLASSES)
      initial[cls] = saved
        ? (saved[cls] ?? 0)
        : total > 0
          ? Math.round(((current[cls] ?? 0) / total) * 10000) / 100
          : 0;
    if (!saved && total > 0) {
      const largest = ASSET_CLASSES.reduce((a, b) =>
        (current[a] ?? 0) >= (current[b] ?? 0) ? a : b,
      );
      initial[largest] =
        Math.round(
          (initial[largest]! + 100 - Object.values(initial).reduce((n, v) => n + v, 0)) * 100,
        ) / 100;
    }
    targets = initial;
    contribution = 0;
    message = '';
    error = '';
  });
  const plan = $derived(rebalancePlan(current, targets, contribution));
  const totalPct = $derived(Object.values(targets).reduce((n, v) => n + (v ?? 0), 0));
  async function save() {
    saving = true;
    error = '';
    message = '';
    try {
      await api().saveAllocationTargets($state.snapshot(targets), memberId);
      message = 'Targets saved for this selection.';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Allocation planner</Card.Title>
    <Card.Description>Set your own targets and see the gap at today’s values.</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-5">
    <div class="grid gap-2 sm:max-w-xs">
      <label for="contribution" class="text-sm font-medium">New contribution (₹)</label>
      <Input
        id="contribution"
        type="number"
        min="0"
        step="1000"
        aria-label="New contribution"
        bind:value={contribution}
      />
    </div>
    <div class="grid gap-2">
      <div
        class="text-muted-foreground grid grid-cols-[minmax(0,1fr)_5rem_6rem] items-end gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_5rem_6rem_8rem]"
      >
        <span>Asset class</span><span class="text-right">Current</span><span class="text-right"
          >Target %</span
        ><span class="hidden text-right sm:block">Gap (₹)</span>
      </div>
      {#each ASSET_CLASSES as cls (cls)}
        {@const row = plan.rows.find((r) => r.assetClass === cls)}
        <div
          class="grid grid-cols-[minmax(0,1fr)_5rem_6rem] items-center gap-2 border-t py-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_8rem]"
        >
          <label for={`target-${cls}`} class="text-sm font-medium">{CLASS_NAMES[cls]}</label>
          <span class="text-right text-sm tabular-nums"
            >{pct(
              row?.currentShare ??
                (current[cls] ?? 0) / (Object.values(current).reduce((n, v) => n + v, 0) || 1),
              1,
            )}</span
          >
          <Input
            id={`target-${cls}`}
            aria-label={`${CLASS_NAMES[cls]} target %`}
            type="number"
            min="0"
            max="100"
            step="0.1"
            bind:value={targets[cls]}
            oninput={() => {
              message = '';
            }}
            class="text-right tabular-nums"
          />
          <span
            class="text-muted-foreground col-span-3 text-right text-xs tabular-nums sm:col-span-1 sm:text-sm"
            >{row ? inrSigned(row.change) : '—'}<span class="sm:hidden"> to target</span></span
          >
        </div>
      {/each}
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-muted-foreground text-sm" aria-live="polite">
        Total targets: {Number.isFinite(totalPct) ? totalPct.toFixed(1) : '—'}% · Scenario value {inr(
          plan.total,
        )}
      </p>
      <Button onclick={save} disabled={!plan.valid || saving || app.vault?.readOnly}
        >{saving ? 'Saving…' : 'Save targets'}</Button
      >
    </div>
    {#if !plan.valid}<p class="text-destructive text-sm" role="status">
        Targets must total 100% with each between 0 and 100. Enter a non-negative contribution.
      </p>{/if}
    {#if message}<p class="text-sm" role="status">{message}</p>{/if}
    {#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
    <p class="text-muted-foreground text-xs leading-relaxed">
      Positive gaps show amounts to add; negative gaps show amounts above your target. This scenario
      includes the new contribution and excludes taxes, fees, exit loads and lock-ins. Targets are
      saved separately for Everyone and each member.
    </p>
  </Card.Content>
</Card.Root>
