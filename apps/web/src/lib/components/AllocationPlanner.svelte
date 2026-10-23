<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import {
    type AllocationPlanSettings,
    type AllocationTargets,
    ASSET_CLASSES,
    DEFAULT_BAND,
    type HybridFund,
    MAX_BAND,
    type RebalanceMode,
    rebalancePlan,
    validAllocationTargets,
  } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import { CLASS_NAMES, date, inr, inrSigned, pct, points } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';

  import { Button } from './ui/button/index.ts';
  import * as Card from './ui/card/index.ts';
  import { Input } from './ui/input/index.ts';
  import * as ToggleGroup from './ui/toggle-group/index.ts';

  let {
    current,
    saved,
    settings,
    memberId,
    shortfall = 0,
    hybrid = [],
  }: {
    current: AllocationTargets;
    saved: AllocationTargets | null;
    settings: AllocationPlanSettings | null;
    memberId?: string;
    /** How far the saved emergency fund is below its target. */
    shortfall?: number;
    /** Hybrid funds, already split into the classes in `current`. */
    hybrid?: HybridFund[];
  } = $props();
  let targets = $state<AllocationTargets>({});
  let amount = $state(0);
  let band = $state(DEFAULT_BAND);
  let mode = $state<RebalanceMode>('new-money');
  // The mode to go back to if the chosen one is pressed again, which would leave neither chosen.
  let chosen: RebalanceMode = 'new-money';
  let saving = $state(false);
  let message = $state('');
  let error = $state('');
  $effect(() => {
    // Changing member or refreshing holdings resets the scenario to its saved plan.
    void memberId;
    const total = Object.values(current).reduce((n, v) => n + v, 0);
    const initial: AllocationTargets = {};

    for (const cls of ASSET_CLASSES) {
      initial[cls] = saved
        ? (saved[cls] ?? 0)
        : total > 0
          ? Math.round(((current[cls] ?? 0) / total) * 10000) / 100
          : 0;
    }

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
    amount = settings?.amount ?? 0;
    band = settings?.band ?? DEFAULT_BAND;
    mode = chosen = settings?.mode ?? 'new-money';
    message = '';
    error = '';
  });
  const plan = $derived(rebalancePlan(current, targets, amount, band));
  const targetsValid = $derived(validAllocationTargets(targets));
  const totalPct = $derived(Object.values(targets).reduce((n, v) => n + (v ?? 0), 0));
  const newMoney = $derived(mode === 'new-money');
  // Hybrid funds are split, so Hybrid shows only while something is still Hybrid or a saved
  // target gives it a share that needs moving elsewhere.
  const classes = $derived(
    ASSET_CLASSES.filter(
      (c) => c !== 'hybrid' || (current.hybrid ?? 0) > 0 || (saved?.hybrid ?? 0) > 0,
    ),
  );
  const estimated = $derived(hybrid.filter((f) => f.method === 'type').length);
  const splitText = (split: AllocationTargets) =>
    ASSET_CLASSES.filter((c) => (split[c] ?? 0) > 0.0005)
      .map((c) => `${pct(split[c], 0)} ${CLASS_NAMES[c]!.toLowerCase()}`)
      .join(' · ');
  const how = (f: HybridFund) =>
    f.method === 'arbitrage'
      ? 'an arbitrage fund, so all Debt'
      : f.method === 'report'
        ? `from its report of ${date(f.asOf)}`
        : `estimated as a typical ${f.type.toLowerCase()} fund, with no report`;
  async function save() {
    saving = true;
    error = '';
    message = '';

    try {
      await api().saveAllocationPlan(
        { targets: $state.snapshot(targets), mode, band, amount },
        memberId,
      );
      message = 'Plan saved for this selection.';
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
    <Card.Description
      >Set your targets, see what has drifted, and decide where new money goes.</Card.Description
    >
  </Card.Header>
  <Card.Content class="grid gap-5">
    <div class="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,10rem)_auto] sm:items-end">
      <div class="grid gap-2">
        <label for="amount" class="text-sm font-medium">Amount to invest (₹)</label>
        <Input
          id="amount"
          type="number"
          min="0"
          step="1000"
          aria-label="Amount to invest"
          bind:value={amount}
          oninput={() => (message = '')}
        />
      </div>
      <div class="grid gap-2">
        <label for="band" class="text-sm font-medium">Drift band (± points)</label>
        <Input
          id="band"
          type="number"
          min="0"
          max={MAX_BAND}
          step="0.5"
          aria-label="Drift band"
          bind:value={band}
          oninput={() => (message = '')}
        />
      </div>
      <ToggleGroup.Root
        type="single"
        variant="outline"
        bind:value={mode}
        onValueChange={(v) => {
          if (v) {
            chosen = v as RebalanceMode;
          } else {
            mode = chosen;
          }

          message = '';
        }}
        aria-label="Rebalancing"
        class="w-full sm:w-auto"
      >
        <ToggleGroup.Item value="new-money" class="flex-1 sm:flex-none"
          >New money only</ToggleGroup.Item
        >
        <ToggleGroup.Item value="rebalance" class="flex-1 sm:flex-none"
          >Buy and sell</ToggleGroup.Item
        >
      </ToggleGroup.Root>
    </div>

    {#if plan.valid}
      <p class="text-sm" aria-live="polite" data-testid="drift-summary">
        {plan.drifted === 0
          ? `Every class is within ${band} points of its target.`
          : `${plan.drifted} ${plan.drifted === 1 ? 'class is' : 'classes are'} more than ${band} points off target.`}
      </p>
    {/if}
    {#if shortfall > 0}
      <p class="bg-muted/50 flex gap-2 rounded-2xl p-3 text-sm">
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span
          >Your emergency fund is short by {inr(shortfall)}. You may want to top it up before
          investing.</span
        >
      </p>
    {/if}

    <div class="grid gap-2">
      <div
        class="text-muted-foreground grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] items-end gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_6rem_8rem]"
      >
        <span>Asset class</span><span class="text-right">Now</span><span class="text-right"
          >Target %</span
        ><span class="hidden text-right sm:block">Off by</span><span
          class="hidden text-right sm:block">{newMoney ? 'Put in' : 'Change'}</span
        >
      </div>
      {#each classes as cls (cls)}
        {@const row = plan.rows.find((r) => r.assetClass === cls)}
        <div
          class="grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] items-center gap-x-2 gap-y-1 border-t py-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_6rem_8rem]"
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
            oninput={() => (message = '')}
            class="text-right tabular-nums"
          />
          <span
            class="col-span-3 flex justify-end gap-3 text-xs tabular-nums sm:col-span-2 sm:grid sm:grid-cols-[6rem_8rem] sm:gap-2 sm:text-sm"
          >
            <span
              class={cn(
                'text-right',
                row?.outside
                  ? 'font-medium text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground',
              )}
              data-testid={`drift-${cls}`}
              >{row ? points(row.drift) : '—'}<span class="sm:hidden">&nbsp;off</span
              >{#if row?.outside}<span class="sr-only"> (outside the band)</span>{/if}</span
            >
            <span class="text-right" data-testid={`move-${cls}`}
              ><span class="text-muted-foreground sm:hidden"
                >{newMoney ? 'Put in ' : 'Change '}</span
              >{row ? (newMoney ? inr(row.add) : inrSigned(row.change)) : '—'}</span
            >
          </span>
        </div>
      {/each}
    </div>
    {#if hybrid.length}
      <details class="bg-muted/50 rounded-2xl p-3 text-sm" data-testid="hybrid-funds">
        <summary class="cursor-pointer font-medium"
          >How {hybrid.length === 1
            ? 'your hybrid fund is'
            : `your ${hybrid.length} hybrid funds are`} counted{estimated
            ? ` (${estimated} estimated)`
            : ''}</summary
        >
        <ul class="mt-3 grid gap-3">
          {#each hybrid as f (f.id)}
            <li class="grid gap-0.5">
              <span class="flex justify-between gap-3"
                ><span class="min-w-0 break-words">{f.name}</span><span class="tabular-nums"
                  >{inr(f.value)}</span
                ></span
              >
              <span class="text-muted-foreground text-xs">{splitText(f.split)}: {how(f)}</span>
            </li>
          {/each}
        </ul>
        {#if hybrid.some((f) => f.hedged)}
          <p class="text-muted-foreground mt-3 text-xs">
            Balanced advantage and equity savings funds hedge some of their stocks with futures,
            which their reports leave out, so their equity here can be higher than it really is.
          </p>
        {/if}
      </details>
    {/if}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-muted-foreground text-sm" aria-live="polite">
        Total targets: {Number.isFinite(totalPct) ? totalPct.toFixed(1) : '—'}% · After investing {inr(
          plan.total,
        )}
      </p>
      <Button onclick={save} disabled={!plan.valid || saving || app.vault?.readOnly}
        >{saving ? 'Saving…' : 'Save plan'}</Button
      >
    </div>
    {#if !targetsValid}<p class="text-destructive text-sm" role="status">
        Targets must total 100%, each between 0 and 100.
      </p>{:else if !plan.valid}<p class="text-destructive text-sm" role="status">
        Enter an amount of zero or more and a drift band from 0 to {MAX_BAND}.
      </p>{/if}
    {#if message}<p class="text-sm" role="status">{message}</p>{/if}
    {#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
    <p class="text-muted-foreground text-xs leading-relaxed">
      {newMoney
        ? 'New money goes to the classes furthest below target first, and no class goes past its target. Nothing is sold.'
        : 'Positive amounts are to add and negative ones are above your target. Selling can bring tax, exit loads and lock-ins, which aren’t counted here.'}
      Off by compares today’s split with your targets, before the new money. Hybrid funds count as the
      classes they hold. Money you’ve lent or owe isn’t counted. Plans are saved separately for Everyone
      and each member.
    </p>
  </Card.Content>
</Card.Root>
