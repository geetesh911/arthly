<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { emergencyFund } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import AllocationPlanner from '#lib/components/AllocationPlanner.svelte';
  import BreakdownCard from '#lib/components/BreakdownCard.svelte';
  import EmergencyFund from '#lib/components/EmergencyFund.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import { inr } from '#lib/format.ts';
  import type { PlanningDto } from '#lib/worker/dto.ts';

  let data = $state<PlanningDto | null>(null);
  let error = $state('');
  $effect(() => {
    void app.version;
    const filter = $state.snapshot(app.filter);
    let active = true;

    data = null;
    error = '';
    void api()
      .plan(filter)
      .then((d) => {
        if (active) {
          data = d;
        }
      })
      .catch((e) => {
        if (active) {
          error = (e as Error).message;
        }
      });

    return () => {
      active = false;
    };
  });
  // The planner warns from the saved emergency fund, not one still being typed.
  const shortfall = $derived(
    data?.emergencyFund ? emergencyFund(data.emergency, data.emergencyFund).shortfall : 0,
  );
  const liquidityNote = $derived(
    [
      'Only bank / cash is counted as immediately available here. Market holdings can fall in value or have redemption restrictions. Retirement assets, deposits and bonds have their own withdrawal conditions.',
      data?.loans.owedToYou && 'Money owed to you comes back only when it’s repaid.',
      data?.cardDues &&
        `The ${inr(data.cardDues)} left to pay on cards isn’t charted; it’s taken off net worth.`,
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<PageHeader title="Plan" back={{ href: '#/more', label: 'More' }} backClass="lg:hidden" />
<p class="text-muted-foreground text-sm">
  Set your targets, decide where new money goes, and check your safety net.
</p>
{#if error}
  <p class="text-destructive text-sm" role="alert">{error}</p>
{:else if !data}
  <div class="grid gap-4 sm:grid-cols-2">
    <Skeleton class="h-80 rounded-4xl sm:col-span-2" /><Skeleton
      class="h-80 rounded-4xl"
    /><Skeleton class="h-80 rounded-4xl" />
  </div>
{:else if data.total === 0}
  <Empty.Root
    ><Empty.Header
      ><Empty.Title>Your plan starts here</Empty.Title><Empty.Description
        >Add holdings to set targets, split new money and check your emergency fund.</Empty.Description
      ></Empty.Header
    ><Empty.Content><Button href="#/import">Import files</Button></Empty.Content></Empty.Root
  >
{:else}
  <AllocationPlanner
    current={data.assetValues}
    saved={data.targets}
    settings={data.allocation}
    memberId={app.filter.memberId}
    {shortfall}
    hybrid={data.hybrid}
  />

  <div class="grid gap-4 lg:grid-cols-2">
    <EmergencyFund
      money={data.emergency}
      saved={data.emergencyFund}
      memberId={app.filter.memberId}
      onsave={(settings) => {
        if (data) {
          data.emergencyFund = settings;
        }
      }}
    />
    <BreakdownCard
      title="Access to your money"
      description="All holdings · plan near-term spending separately"
      data={data.liquidity}
      note={liquidityNote}
    />
    <BreakdownCard
      title="Maturity ladder"
      description="FDs, bonds and SGBs · current value by maturity date"
      data={data.maturities}
      coverage
      wide
      note="These are current holding values, not projected maturity payouts. Provident funds and unscheduled assets are excluded. Confirm renewal and redemption dates before planning spending."
    />
  </div>
{/if}
