<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { type AverageNavInput, averageNavProblem, newAverageNav, type SizedBy } from '@pv/core';

  import { pct, typed, units } from '#lib/format.ts';

  import * as Card from './ui/card/index.ts';
  import { Input } from './ui/input/index.ts';
  import * as ToggleGroup from './ui/toggle-group/index.ts';
  import FormField from './FormField.svelte';
  import Stat from './Stat.svelte';

  let averageNav = $state<number | null>(50);
  let heldBy = $state<SizedBy>('units');
  let held = $state<number | null>(100);
  let nav = $state<number | null>(40);
  let buyBy = $state<SizedBy>('amount');
  let buy = $state<number | null>(4000);

  // An empty field is NaN, so it's caught as missing rather than taken as 0.
  const num = (n: number | null) => n ?? Number.NaN;
  const input = $derived<AverageNavInput>({
    averageNav: num(averageNav),
    held: { by: heldBy, value: num(held) },
    nav: num(nav),
    buy: { by: buyBy, value: num(buy) },
  });
  const problem = $derived(averageNavProblem(input));
  const result = $derived(problem ? null : newAverageNav(input));

  // NAVs are published to 4 decimals.
  const navFmt = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const navText = (n: number) => navFmt.format(n);
  const unitsText = (n: number) => `${units(n)} ${n === 1 ? 'unit' : 'units'}`;
  const summary = $derived.by(() => {
    if (!result) {
      return '';
    }

    const from = navText(input.averageNav);
    const to = navText(result.averageNav);

    return from === to
      ? `Your average NAV stays at ${from}.`
      : `Your average NAV goes ${result.change < 0 ? 'down' : 'up'} from ${from} to ${to}.`;
  });

  const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

  /** The same units as the other kind, so switching doesn't change the answer. */
  function convert(value: number | null, to: SizedBy, at: number | null): number | null {
    if (value === null || !at) {
      return null;
    }

    // Funds allot units to 3 decimals.
    return to === 'amount' ? round(value * at, 2) : round(value / at, 3);
  }

  function holdAs(by: SizedBy | '') {
    if (by && by !== heldBy) {
      held = convert(held, by, averageNav);
      heldBy = by;
    }
  }

  function buyAs(by: SizedBy | '') {
    if (by && by !== buyBy) {
      buy = convert(buy, by, nav);
      buyBy = by;
    }
  }
</script>

{#snippet sizedBy(label: string, by: SizedBy, set: (by: SizedBy | '') => void)}
  <!-- Pressing the chosen one again would leave neither chosen, so it's ignored. -->
  <ToggleGroup.Root
    type="single"
    variant="outline"
    bind:value={() => by, (v) => set(v as SizedBy | '')}
    aria-label={label}
    class="w-full"
  >
    <ToggleGroup.Item value="units" class="flex-1">Units</ToggleGroup.Item>
    <ToggleGroup.Item value="amount" class="flex-1">Amount</ToggleGroup.Item>
  </ToggleGroup.Root>
{/snippet}

<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-lg font-semibold">You hold</Card.Title>
      <Card.Description>From the fund’s page in your app or your statement.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <FormField label="Average NAV (₹)" hint="What each unit cost you, on average.">
        <Input type="number" min="0" step="any" bind:value={averageNav} />
      </FormField>
      <div class="grid gap-3">
        {@render sizedBy('Enter what you hold as', heldBy, holdAs)}
        {#if heldBy === 'units'}
          <FormField
            label="Units you hold"
            hint={result ? `They cost ${typed.inrExact(result.heldCost)}.` : undefined}
          >
            <Input type="number" min="0" step="any" bind:value={held} />
          </FormField>
        {:else}
          <FormField
            label="Amount invested (₹)"
            hint={result ? `For ${unitsText(result.heldUnits)}.` : undefined}
          >
            <Input type="number" min="0" step="any" bind:value={held} />
          </FormField>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="text-lg font-semibold">You buy</Card.Title>
      <Card.Description>More of the same fund, at today’s NAV or another.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <FormField label="Buying NAV (₹)" hint="Today’s NAV, or the one you expect to buy at.">
        <Input type="number" min="0" step="any" bind:value={nav} />
      </FormField>
      <div class="grid gap-3">
        {@render sizedBy('Enter what you buy as', buyBy, buyAs)}
        {#if buyBy === 'units'}
          <FormField
            label="Units to buy"
            hint={result ? `They cost ${typed.inrExact(result.boughtCost)}.` : undefined}
          >
            <Input type="number" min="0" step="any" bind:value={buy} />
          </FormField>
        {:else}
          <FormField
            label="Amount to invest (₹)"
            hint={result ? `It buys ${unitsText(result.boughtUnits)}.` : undefined}
          >
            <Input type="number" min="0" step="any" bind:value={buy} />
          </FormField>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root class="lg:col-span-2">
    <Card.Header>
      <Card.Title class="text-lg font-semibold">New average</Card.Title>
      <Card.Description>What all your units cost, over how many you’ll hold.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-6" aria-live="polite">
      {#if problem}
        <p class="text-muted-foreground text-sm">{problem}</p>
      {:else if result}
        <p class="text-lg font-semibold" data-testid="average-summary">{summary}</p>
        <div class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
          <Stat label="New average NAV" value={navText(result.averageNav)} testid="new-average" />
          <Stat
            label="Change in average"
            value={pct(result.change, 2, true)}
            testid="average-change"
          />
          <Stat
            label="Units"
            value={units(result.units)}
            hint={`${units(result.heldUnits)} + ${units(result.boughtUnits)}`}
            testid="total-units"
          />
          <Stat
            label="Invested"
            value={typed.inrExact(result.cost)}
            hint={`${typed.inrExact(result.heldCost)} + ${typed.inrExact(result.boughtCost)}`}
            testid="total-invested"
          />
          <Stat
            label="Return now"
            value={pct(result.returnBefore, 2, true)}
            tone={result.returnBefore > 0 ? 'gain' : result.returnBefore < 0 ? 'loss' : undefined}
            hint={`At ${navText(input.nav)}`}
            testid="return-before"
          />
          <Stat
            label="Return after buying"
            value={pct(result.returnAfter, 2, true)}
            tone={result.returnAfter > 0 ? 'gain' : result.returnAfter < 0 ? 'loss' : undefined}
            hint={`At ${navText(input.nav)}`}
            testid="return-after"
          />
        </div>
      {/if}
      <div class="text-muted-foreground grid gap-2 text-xs leading-relaxed">
        <p>
          Buying below your average NAV brings it down, and buying above it brings it up. A lower
          average makes the return look better, but what you’ve gained or lost in rupees on the
          units you already hold stays the same. It works the same way for a stock’s average price.
        </p>
        <p>
          Stamp duty of 0.005% on fund purchases, exit loads and other charges are left out. Funds
          allot units to 3 decimals, so your statement can be a paisa or so off.
        </p>
      </div>
    </Card.Content>
  </Card.Root>
</div>
