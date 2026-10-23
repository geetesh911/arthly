<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import AllocationPlanner from '#lib/components/AllocationPlanner.svelte';
  import BreakdownCard from '#lib/components/BreakdownCard.svelte';
  import ExposureTable from '#lib/components/ExposureTable.svelte';
  import FundHoldings from '#lib/components/FundHoldings.svelte';
  import IndexBenchmarks from '#lib/components/IndexBenchmarks.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import { CLASS_NAMES, date, inr, pct } from '#lib/format.ts';
  import type { AnalyticsDto } from '#lib/worker/dto.ts';

  let data = $state<AnalyticsDto | null>(null);
  let error = $state('');
  let refreshMessage = $state('');
  let refreshing = $state(false);
  $effect(() => {
    void app.version;
    const filter = $state.snapshot(app.filter);
    let active = true;

    data = null;
    error = '';
    void api()
      .analytics(filter)
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
  // What went wrong in the latest fund report refresh, grouped by AMC.
  const fundFailures = $derived.by(() => {
    const groups: Record<string, string[]> = {};

    for (const f of data?.reference.fundFailures ?? []) {
      (groups[f.label] ??= []).push(f.message);
    }

    return Object.entries(groups);
  });
  // What you're owed is a slice in the asset split; what you owe never is.
  const loansNote = $derived.by(() => {
    const parts = [
      data?.loans.owedToYou && `Includes ${inr(data.loans.owedToYou)} owed to you.`,
      data?.loans.youOwe &&
        `The ${inr(data.loans.youOwe)} you owe isn’t charted; it’s taken off net worth.`,
    ].filter(Boolean);

    return parts.length ? ` ${parts.join(' ')}` : '';
  });
  async function refresh() {
    refreshing = true;
    refreshMessage = '';

    try {
      const result = await api().refreshPrices(true);

      refreshMessage = result.ok ? 'Prices refreshed.' : (result.message ?? 'Using saved prices.');
      app.version++;
    } catch (e) {
      refreshMessage = (e as Error).message;
    } finally {
      refreshing = false;
    }
  }
  /** Shows new figures without blanking the page, so the fund card keeps its message. */
  async function reload() {
    data = await api().analytics($state.snapshot(app.filter));
  }
</script>

<PageHeader title="Analytics" back={{ href: '#/more', label: 'More' }} backClass="lg:hidden">
  {#snippet actions()}<Button variant="outline" size="sm" onclick={refresh} disabled={refreshing}
      ><RefreshCw class={refreshing ? 'animate-spin' : ''} />{refreshing
        ? 'Refreshing…'
        : 'Refresh data'}</Button
    >{/snippet}
</PageHeader>
<p class="text-muted-foreground text-sm">
  Understand your exposures and plan your next contribution.
</p>
{#if refreshMessage}<p class="text-muted-foreground text-sm" role="status">{refreshMessage}</p>{/if}
{#if error}
  <p class="text-destructive text-sm" role="alert">{error}</p>
{:else if !data}
  <div class="grid gap-4 sm:grid-cols-2">
    <Skeleton class="h-32 rounded-4xl" /><Skeleton class="h-32 rounded-4xl" /><Skeleton
      class="h-80 rounded-4xl"
    /><Skeleton class="h-80 rounded-4xl" />
  </div>
{:else if data.total === 0}
  <Empty.Root
    ><Empty.Header
      ><Empty.Title>Your portfolio analysis starts here</Empty.Title><Empty.Description
        >Add holdings to see allocation, concentration and planning insights.</Empty.Description
      ></Empty.Header
    ><Empty.Content><Button href="#/add">Add holdings</Button></Empty.Content></Empty.Root
  >
  <IndexBenchmarks data={data.indices} />
{:else}
  <Card.Root>
    <Card.Content class="grid grid-cols-2 gap-5 sm:grid-cols-4">
      <Stat label="Portfolio value" value={inr(data.total)} />
      <Stat label="Unique holdings" value={String(data.holdings.count)} />
      <Stat label="Largest holding" value={pct(data.holdings.top1, 1)} />
      <Stat
        label="Bank / cash"
        value={pct(
          (data.liquidity.slices.find((s) => s.label === 'Bank / cash')?.value ?? 0) / data.total,
          1,
        )}
      />
    </Card.Content>
  </Card.Root>

  <div class="grid gap-4 lg:grid-cols-2">
    <BreakdownCard
      title="Asset split"
      description={data.loans.owedToYou > 0
        ? 'All holdings and money owed to you'
        : 'All holdings · share of total portfolio value'}
      data={data.assetSplit}
      labels={CLASS_NAMES}
      note={`Hybrid funds remain a separate asset class. Fund holdings are not decomposed into equity, debt or cash.${loansNote}`}
    />
    <BreakdownCard
      title="Underlying asset split"
      description="Includes reported fund cash, debt and commodities"
      data={data.lookthrough.assetSplit}
      labels={CLASS_NAMES}
      estimated={data.lookthrough.byFundType}
      note={`Positive asset values shown. A fund without a holdings report counts under its own type, such as a gold ETF under Gold, including any cash it keeps.${data.lookthrough.adjustments < 0 ? ` Net liability adjustments of ${inr(data.lookthrough.adjustments)} are excluded from this chart.` : ''} The allocation planner uses the instrument-level Asset split.`}
    />
    <BreakdownCard
      title="Investment vehicles"
      description="All holdings · how your portfolio is held"
      data={data.instrumentSplit}
    />
    <BreakdownCard
      title="Active / passive split"
      description="Mutual funds and ETFs only · eligible fund value"
      data={data.strategy}
      coverage
      note="Index funds and ETFs are passive; recognised managed fund categories are active. Direct stocks are excluded. Funds of funds and ambiguous schemes remain unclassified. Direct and regular refer to distribution plans, not investment strategy."
    />
    <BreakdownCard
      title="Sector allocation"
      description="Direct stocks + reported fund stocks · NSE sectors"
      data={data.sectors}
      coverage
      note="Sectors come from NSE’s index lists, or from the industry in a fund’s report, grouped into NSE’s 22 sectors. Fund stocks use current fund value × disclosed weight; known cash and debt are excluded. Funds without a report and stocks with no known industry, such as foreign stocks, remain unclassified; this can include an unreported fund’s non-equity part."
    />
    <BreakdownCard
      title="Market cap split"
      description="Direct stocks + reported fund stocks · AMFI categories"
      data={data.marketCap}
      coverage
      note={data.reference.caps
        ? `Cap sizes come from AMFI’s official list for the six months to ${date(data.reference.caps.asOf)}: the 100 largest companies by average market value are large caps, the next 150 mid caps and the rest small caps. Funds without a report and stocks not on the list, such as recent listings, remain unclassified.`
        : 'Cap sizes come from AMFI’s official list, which hasn’t loaded yet. Refresh data to load it.'}
    />
    <BreakdownCard
      title="Access to your money"
      description="All holdings · plan near-term spending separately"
      data={data.liquidity}
      note={`Only bank / cash is counted as immediately available here. Market holdings can fall in value or have redemption restrictions. Retirement assets, deposits and bonds have their own withdrawal conditions.${data.loans.owedToYou > 0 ? ' Money owed to you comes back only when it’s repaid.' : ''}`}
    />
    <BreakdownCard
      title="Maturity ladder"
      description="FDs, bonds and SGBs · current value by maturity date"
      data={data.maturities}
      coverage
      note="These are current holding values, not projected maturity payouts. Provident funds and unscheduled assets are excluded. Confirm renewal and redemption dates before planning spending."
    />
    <BreakdownCard
      title="Currency exposure"
      description="All holdings · currency denomination"
      data={data.currency}
      wide
      note="Values are converted to INR. An INR-denominated international fund remains INR here; this view does not measure its underlying foreign-currency exposure."
    />
  </div>

  <Card.Root>
    <Card.Header
      ><Card.Title class="text-lg font-semibold">Largest portfolio positions</Card.Title
      ><Card.Description
        >All asset types · see which holdings drive your overall exposure and unrealised gain.</Card.Description
      ></Card.Header
    >
    <Card.Content class="px-3 sm:px-6"><ExposureTable data={data.holdings} /></Card.Content>
  </Card.Root>
  <Card.Root>
    <Card.Header
      ><Card.Title class="text-lg font-semibold">Stock concentration</Card.Title><Card.Description
        >Direct stocks and estimated physical stock exposure inside funds, combined by ISIN.</Card.Description
      ></Card.Header
    >
    <Card.Content class="px-3 sm:px-6"
      ><ExposureTable data={data.stocks} stocks />
      <p class="text-muted-foreground mt-3 text-xs">
        Concentration uses identified stocks only. Indirect amounts use dated fund weights; missing
        fund allocations and derivative hedges are excluded. Fund value covered: {data.lookthrough
          .coverage.total
          ? pct(data.lookthrough.coverage.covered / data.lookthrough.coverage.total, 1)
          : '—'}.
      </p></Card.Content
    >
  </Card.Root>
  <FundHoldings data={data.lookthrough} added={data.reference.addedReports} onchange={reload} />

  <AllocationPlanner
    current={data.assetValues}
    saved={data.targets}
    memberId={app.filter.memberId}
  />

  <IndexBenchmarks data={data.indices} />

  <Card.Root>
    <Card.Header
      ><Card.Title class="text-lg font-semibold">Data behind the analysis</Card.Title
      ><Card.Description>Coverage matters when comparing allocations.</Card.Description
      ></Card.Header
    >
    <Card.Content class="grid gap-4">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Market holdings with stale prices"
          value={data.valuation.total ? pct(data.valuation.stale / data.valuation.total, 1) : '—'}
        />
        <Stat
          label="Market values marked estimated"
          value={data.valuation.total
            ? pct(data.valuation.estimated / data.valuation.total, 1)
            : '—'}
        />
        <Stat
          label="AMFI schemes loaded"
          value={data.reference.amfiSchemes.toLocaleString('en-IN')}
        />
        <Stat label="Fund reports loaded" value={String(data.reference.fundReports)} />
      </div>
      <p class="text-muted-foreground text-xs leading-relaxed">
        Stale prices are more than four days old. Estimated values may use a statement or cost when
        a current price is unavailable. NSE classifications: {data.reference.nseDate
          ? `retrieved ${date(data.reference.nseDate)}`
          : 'not loaded'}.{data.reference.nseStale
          ? ' Some classification data is missing or retained from an earlier refresh.'
          : ''} Refresh data to update the whole AMFI and NSE lists.
      </p>
      <p class="text-muted-foreground text-xs leading-relaxed break-words">
        {#if data.reference.caps}
          AMFI cap list: six months to {date(data.reference.caps.asOf)}, {data.reference.caps.companies.toLocaleString(
            'en-IN',
          )} companies, retrieved {date(data.reference.caps.date)} ·
          <a
            href={data.reference.caps.url}
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-4">Official file</a
          >.{data.reference.caps.stale ? ' AMFI should have a newer list by now.' : ''}
        {:else}
          AMFI cap list: not loaded.
        {/if}
        {#if data.reference.capsFailure}Couldn’t refresh it ({data.reference.capsFailure}).{/if}
      </p>
      {#if fundFailures.length}
        <div class="grid gap-1 text-xs">
          <p class="text-muted-foreground">
            Some fund reports couldn’t be refreshed. Funds keep any report saved earlier, with its
            own date.
          </p>
          <ul class="grid gap-1">
            {#each fundFailures as [label, messages] (label)}
              <li class="break-words">
                <span class="font-medium">{label}:</span>
                <span class="text-muted-foreground"
                  >{messages[0]}{messages.length > 1
                    ? ` (and ${messages.length - 1} more)`
                    : ''}</span
                >
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <p class="text-muted-foreground text-xs">
        As of {date(data.date)} · Percentages in each chart use the included value shown below it.
      </p>
    </Card.Content>
  </Card.Root>
{/if}
