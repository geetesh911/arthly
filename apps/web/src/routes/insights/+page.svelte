<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Info from '@lucide/svelte/icons/info';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { type Breakdown, DEFAULT_BAND, rebalancePlan } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import BottomSheet from '#lib/components/BottomSheet.svelte';
  import BreakdownCard from '#lib/components/BreakdownCard.svelte';
  import ExposureTable from '#lib/components/ExposureTable.svelte';
  import FundHoldings from '#lib/components/FundHoldings.svelte';
  import IndexBenchmarks from '#lib/components/IndexBenchmarks.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import StackedBar from '#lib/components/StackedBar.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Empty from '#lib/components/ui/empty/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import { CLASS_NAMES, date, inr, inrShort, pct } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';
  import type { AnalyticsDto, PlanningDto } from '#lib/worker/dto.ts';

  let data = $state<AnalyticsDto | null>(null);
  let plan = $state<PlanningDto | null>(null);
  let error = $state('');
  let refreshMessage = $state('');
  let refreshing = $state(false);
  let more = $state(false);
  const opened = $state<Record<string, boolean>>({});

  $effect(() => {
    void app.version;
    const filter = $state.snapshot(app.filter);
    let active = true;

    data = null;
    error = '';
    void Promise.all([api().analytics(filter), api().plan(filter)])
      .then(([d, p]) => {
        if (active) {
          data = d;
          plan = p;
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
  // What you're owed is a slice in the asset split; what you owe and card dues never are.
  const cardsNote = $derived(
    data?.cardDues
      ? ` The ${inr(data.cardDues)} left to pay on cards isn’t charted; it’s taken off net worth.`
      : '',
  );
  const loansNote = $derived.by(() => {
    const parts = [
      data?.loans.owedToYou && `Includes ${inr(data.loans.owedToYou)} owed to you.`,
      data?.loans.youOwe &&
        `The ${inr(data.loans.youOwe)} you owe isn’t charted; it’s taken off net worth.`,
    ].filter(Boolean);

    return (parts.length ? ` ${parts.join(' ')}` : '') + cardsNote;
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
  /** Shows new figures without blanking the page, so the fund section keeps its message. */
  async function reload() {
    data = await api().analytics($state.snapshot(app.filter));
  }

  /** Each slice's name and share, largest first. */
  function shares(b: Breakdown, names: Record<string, string> = {}) {
    return b.slices
      .filter((s) => s.value > 0)
      .map((s) => ({ name: names[s.label] ?? s.label, share: b.total > 0 ? s.value / b.total : 0 }))
      .sort((x, y) => y.share - x.share);
  }

  /** The largest known slice, as a row's hint: "Debt 70%". */
  function lead(b: Breakdown, names?: Record<string, string>) {
    const top = shares(b, names).find((s) => s.name !== 'Unclassified');

    return top ? `${top.name} ${pct(top.share, 0)}` : b.total > 0 ? 'Not available yet' : '';
  }

  /** Mid-sentence, a name keeps its capitals only when it starts with an acronym, like PPF. */
  const inSentence = (name: string) => (/^[A-Z]{2}/.test(name) ? name : name.toLowerCase());

  // A sentence a person would say, from the biggest slices.
  const summary = $derived.by(() => {
    if (!data) {
      return null;
    }

    const [a, b] = shares(data.assetSplit, CLASS_NAMES);
    const [v, w] = shares(data.instrumentSplit);
    const headline = !a
      ? ''
      : a.share >= 0.5
        ? `Most of your money is in ${inSentence(a.name)}.`
        : b && a.share - b.share < 0.1
          ? `Your money is split between ${inSentence(a.name)} and ${inSentence(b.name)}.`
          : `${a.name} is your largest share, at ${pct(a.share, 0)}.`;
    const held = w
      ? `${v!.name} and ${inSentence(w.name)} hold ${pct(v!.share + w.share, 0)} of your ${inrShort(data.total)}.`
      : v
        ? `${v.name} holds all of your ${inrShort(data.total)}.`
        : '';

    return {
      headline,
      detail: `${held} Your largest holding is ${pct(data.holdings.top1, 0)} of it.`,
    };
  });

  const band = $derived(plan?.allocation?.band ?? DEFAULT_BAND);
  const drift = $derived(
    plan?.targets ? rebalancePlan(plan.assetValues, plan.targets, 0, band) : null,
  );
  type MixRow = { name: string; share: number; target: number | null; outside: boolean };
  // With saved targets, the planner's split (hybrid funds split up); without, the asset split.
  const mix = $derived.by(() => {
    const rows: MixRow[] = drift?.valid
      ? drift.rows
          .filter((r) => r.currentShare > 0 || r.targetPct > 0)
          .map((r) => ({
            name: CLASS_NAMES[r.assetClass] ?? r.assetClass,
            share: r.currentShare,
            target: r.targetPct / 100,
            outside: r.outside,
          }))
      : data
        ? shares(data.assetSplit, CLASS_NAMES).map((s) => ({ ...s, target: null, outside: false }))
        : [];

    return rows.sort((x, y) => y.share - x.share);
  });
  const capped = $derived(!!data && data.marketCap.classified > 0);
  const toggle = (key: string) => (opened[key] = !opened[key]);
</script>

<!-- A row that opens in place, so the long tail of analysis stays out of the way. -->
{#snippet disclosure(key: string, title: string, hint: string, body: Snippet)}
  <!-- Named by its title alone; the hint describes it. -->
  <section aria-labelledby={`more-${key}`} class="border-t">
    <button
      type="button"
      aria-expanded={!!opened[key]}
      aria-labelledby={`more-${key}`}
      aria-describedby={`more-${key}-hint`}
      onclick={() => toggle(key)}
      class="flex min-h-13 w-full items-center gap-3 text-left"
    >
      <span id={`more-${key}`} class="text-body min-w-0 flex-1">{title}</span>
      <span id={`more-${key}-hint`} class="text-muted-foreground text-small truncate">{hint}</span>
      <ChevronDown
        class={cn(
          'text-muted-foreground size-4 shrink-0 transition-transform',
          opened[key] && 'rotate-180',
        )}
      />
    </button>
    {#if opened[key]}<div class="grid grid-cols-1 gap-4 pt-1 pb-6">{@render body()}</div>{/if}
  </section>
{/snippet}

<PageHeader title="Insights" amounts>
  {#snippet actions()}<Button variant="outline" size="sm" onclick={refresh} disabled={refreshing}
      ><RefreshCw class={refreshing ? 'animate-spin' : ''} />{refreshing
        ? 'Refreshing…'
        : 'Refresh data'}</Button
    >{/snippet}
</PageHeader>
{#if refreshMessage}<p class="text-muted-foreground text-small" role="status">
    {refreshMessage}
  </p>{/if}
{#if error}
  <p class="text-destructive text-sm" role="alert">{error}</p>
{:else if !data}
  <div class="grid gap-6">
    <Skeleton class="h-28 rounded-2xl" />
    <Skeleton class="h-48 rounded-2xl" />
  </div>
{:else if data.total === 0}
  <Empty.Root
    ><Empty.Header
      ><Empty.Title>Your portfolio analysis starts here</Empty.Title><Empty.Description
        >Add holdings to see allocation, concentration and fund holdings.</Empty.Description
      ></Empty.Header
    ><Empty.Content><Button href="#/import">Import files</Button></Empty.Content></Empty.Root
  >
  <!-- Indices don't depend on holdings, so they're here from the start. -->
  <section aria-labelledby="indices" class="grid gap-3">
    <h2 id="indices" class="text-title font-semibold">Indices and benchmarks</h2>
    <IndexBenchmarks data={data.indices} />
  </section>
{:else}
  <!-- One column that can't grow past the screen, so long names truncate instead. -->
  <div class="grid grid-cols-1 gap-8 lg:max-w-3xl">
    {#if summary?.headline}
      <section aria-label="In short" class="grid gap-2">
        <span class="text-muted-foreground text-small">In short</span>
        <p class="text-headline font-semibold">{summary.headline}</p>
        <p class="text-muted-foreground text-body">{summary.detail}</p>
      </section>
    {/if}

    <section aria-labelledby="mix" class="grid gap-4">
      <div class="-my-2 flex items-center">
        <h2 id="mix" class="text-title font-semibold">
          {drift?.valid ? 'Mix vs target' : 'Your mix'}
        </h2>
        <BottomSheet title="How this is counted">
          {#snippet trigger(props)}
            <button
              {...props}
              type="button"
              aria-label="How this is counted"
              class="text-muted-foreground hover:text-foreground grid size-11 place-items-center"
              ><Info class="size-[18px]" /></button
            >
          {/snippet}
          <div class="text-body grid gap-3">
            {#if drift?.valid}
              <p>
                Hybrid funds are split into the classes they hold, as on Plan. A class is off target
                when it’s more than {band} points away.
              </p>
            {:else}
              <p>
                Share of all holdings{data.loans.owedToYou > 0 ? ' and money owed to you' : ''}.
                Hybrid funds stay a class of their own here; Plan splits them.
              </p>
            {/if}
            {#if loansNote}<p class="text-muted-foreground">{loansNote.trim()}</p>{/if}
          </div>
        </BottomSheet>
        <span class="flex-1"></span>
        <Button variant="ghost" size="sm" href="#/plan" class="-mr-3"
          >{drift?.valid ? 'Edit' : 'Set targets'}</Button
        >
      </div>
      {#if drift?.valid}
        <p class="text-body flex items-center gap-2">
          {#if drift.drifted === 0}
            <Check class="text-muted-foreground size-[18px] shrink-0" />On target. Every class is
            within {band} points.
          {:else}
            <CircleAlert class="text-warn size-[18px] shrink-0" />{drift.drifted}
            {drift.drifted === 1 ? 'class is' : 'classes are'} more than {band} points off.
          {/if}
        </p>
      {/if}
      {#each mix as m, i (m.name)}
        <div class="grid gap-2">
          <div class="flex items-baseline gap-2">
            <span class="text-body flex-1 font-semibold">{m.name}</span>
            <span class="text-body font-semibold tabular-nums">{pct(m.share, 1)}</span>
            {#if m.target !== null}
              <span class="text-muted-foreground text-small w-20 text-right tabular-nums"
                >target {pct(m.target, 0)}</span
              >
            {/if}
          </div>
          <div
            role="img"
            aria-label={`${m.name} is ${pct(m.share, 1)}${m.target === null ? '' : `, target ${pct(m.target, 0)}`}`}
            class="bg-muted relative h-2 rounded-full"
          >
            <span
              class="absolute inset-y-0 left-0 rounded-full"
              style:width={`${Math.min(1, m.share) * 100}%`}
              style:background={`var(--chart-${(i % 7) + 1})`}
            ></span>
            {#if m.target !== null}
              <span
                class={cn(
                  'absolute -top-1 h-4 w-0.5 rounded-full',
                  m.outside ? 'bg-warn' : 'bg-foreground',
                )}
                style:left={`calc(${Math.min(1, m.target) * 100}% - 1px)`}
              ></span>
            {/if}
          </div>
        </div>
      {/each}
    </section>

    <section aria-labelledby="held" class="grid grid-cols-1 gap-3">
      <h2 id="held" class="text-title font-semibold">Where it’s held</h2>
      <StackedBar
        slices={data.instrumentSplit.slices.map((s) => [s.label, s.value])}
        legend="list"
        label="Where it’s held"
      />
    </section>

    {#if capped}
      <section aria-labelledby="caps" class="grid gap-3">
        <div class="grid gap-0.5">
          <h2 id="caps" class="text-title font-semibold">Market cap</h2>
          <p class="text-muted-foreground text-small">
            Stocks you hold, directly or through funds · {pct(
              data.marketCap.classified / data.marketCap.total,
              0,
            )} classified
          </p>
        </div>
        <StackedBar
          slices={data.marketCap.slices.map((s) => [s.label, s.value])}
          label="Market cap"
        />
      </section>
    {:else}
      <section aria-label="Sectors and market cap" class="bg-muted grid gap-1 rounded-2xl p-4">
        <div class="grid gap-1">
          <span class="text-body font-semibold">Sectors and market cap</span>
          <span class="text-muted-foreground text-small"
            >Not available yet. Refresh data to load the NSE and AMFI lists and your funds’ monthly
            reports.</span
          >
        </div>
      </section>
    {/if}

    <section aria-label="More breakdowns" class="grid grid-cols-1">
      <button
        type="button"
        aria-expanded={more}
        onclick={() => (more = !more)}
        class="flex min-h-13 w-full items-center gap-3 border-t text-left"
      >
        <span class="text-title flex-1 font-semibold">More breakdowns</span>
        <ChevronDown
          class={cn('text-muted-foreground size-[18px] transition-transform', more && 'rotate-180')}
        />
      </button>
      {#if more}
        {#snippet assetSplit()}
          <BreakdownCard
            heading={false}
            title="Asset split"
            description={data!.loans.owedToYou > 0
              ? 'All holdings and money owed to you'
              : 'All holdings · share of total portfolio value'}
            data={data!.assetSplit}
            labels={CLASS_NAMES}
            note={`Hybrid funds remain a separate asset class here. Fund holdings are not decomposed into equity, debt or cash; the planner on Plan splits hybrid funds.${loansNote}`}
          />
        {/snippet}
        {#snippet underlying()}
          <BreakdownCard
            heading={false}
            title="Underlying asset split"
            description="Includes reported fund cash, debt and commodities"
            data={data!.lookthrough.assetSplit}
            labels={CLASS_NAMES}
            estimated={data!.lookthrough.byFundType}
            note={`Positive asset values shown. A fund without a holdings report counts under its own type, such as a gold ETF under Gold, including any cash it keeps.${data!.lookthrough.adjustments < 0 ? ` Net liability adjustments of ${inr(data!.lookthrough.adjustments)} are excluded from this chart.` : ''} The allocation planner on Plan splits hybrid funds this way, and counts arbitrage funds as Debt.`}
          />
        {/snippet}
        {#snippet strategy()}
          <BreakdownCard
            heading={false}
            title="Active / passive split"
            description="Mutual funds and ETFs only · eligible fund value"
            data={data!.strategy}
            coverage
            note="Index funds and ETFs are passive; recognised managed fund categories are active. Direct stocks are excluded. Funds of funds and ambiguous schemes remain unclassified. Direct and regular refer to distribution plans, not investment strategy."
          />
        {/snippet}
        {#snippet sectors()}
          <BreakdownCard
            heading={false}
            title="Sector allocation"
            description="Direct stocks + reported fund stocks · NSE sectors"
            data={data!.sectors}
            coverage
            note="Sectors come from NSE’s index lists, or from the industry in a fund’s report, grouped into NSE’s 22 sectors. Fund stocks use current fund value × disclosed weight; known cash and debt are excluded. Funds without a report and stocks with no known industry, such as foreign stocks, remain unclassified; this can include an unreported fund’s non-equity part."
          />
        {/snippet}
        {#snippet marketCap()}
          <BreakdownCard
            heading={false}
            title="Market cap split"
            description="Direct stocks + reported fund stocks · AMFI categories"
            data={data!.marketCap}
            coverage
            note={data!.reference.caps
              ? `Cap sizes come from AMFI’s official list for the six months to ${date(data!.reference.caps.asOf)}: the 100 largest companies by average market value are large caps, the next 150 mid caps and the rest small caps. Funds without a report and stocks not on the list, such as recent listings, remain unclassified.`
              : 'Cap sizes come from AMFI’s official list, which hasn’t loaded yet. Refresh data to load it.'}
          />
        {/snippet}
        {#snippet currency()}
          <BreakdownCard
            heading={false}
            title="Currency exposure"
            description="All holdings · currency denomination"
            data={data!.currency}
            note="Values are converted to INR. An INR-denominated international fund remains INR here; this view does not measure its underlying foreign-currency exposure."
          />
        {/snippet}
        {#snippet positions()}
          <p class="text-muted-foreground text-small">
            All asset types · see which holdings drive your overall exposure and unrealised gain.
          </p>
          <ExposureTable data={data!.holdings} />
        {/snippet}
        {#snippet stocks()}
          <p class="text-muted-foreground text-small">
            Direct stocks and estimated physical stock exposure inside funds, combined by ISIN.
          </p>
          <ExposureTable data={data!.stocks} stocks />
          <p class="text-muted-foreground text-small">
            Concentration uses identified stocks only. Indirect amounts use dated fund weights;
            missing fund allocations and derivative hedges are excluded. Fund value covered: {data!
              .lookthrough.coverage.total
              ? pct(data!.lookthrough.coverage.covered / data!.lookthrough.coverage.total, 1)
              : '—'}.
          </p>
        {/snippet}
        {#snippet funds()}
          <FundHoldings
            data={data!.lookthrough}
            added={data!.reference.addedReports}
            onchange={reload}
          />
        {/snippet}
        {#snippet indices()}
          <IndexBenchmarks data={data!.indices} />
        {/snippet}
        {#snippet sources()}
          <p class="text-muted-foreground text-small">
            Coverage matters when comparing allocations.
          </p>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Stale market prices"
              value={data!.valuation.total
                ? pct(data!.valuation.stale / data!.valuation.total, 1)
                : '—'}
            />
            <Stat
              label="Estimated market values"
              value={data!.valuation.total
                ? pct(data!.valuation.estimated / data!.valuation.total, 1)
                : '—'}
            />
            <Stat
              label="AMFI schemes loaded"
              value={data!.reference.amfiSchemes.toLocaleString('en-IN')}
            />
            <Stat label="Fund reports loaded" value={String(data!.reference.fundReports)} />
          </div>
          <p class="text-muted-foreground text-small">
            Stale prices are more than four days old. Estimated values may use a statement or cost
            when a current price is unavailable. NSE classifications: {data!.reference.nseDate
              ? `retrieved ${date(data!.reference.nseDate)}`
              : 'not loaded'}.{data!.reference.nseStale
              ? ' Some classification data is missing or retained from an earlier refresh.'
              : ''} Refresh data to update the whole AMFI and NSE lists.
          </p>
          <p class="text-muted-foreground text-small break-words">
            {#if data!.reference.caps}
              AMFI cap list: six months to {date(data!.reference.caps.asOf)}, {data!.reference.caps.companies.toLocaleString(
                'en-IN',
              )} companies, retrieved {date(data!.reference.caps.date)} ·
              <a
                href={data!.reference.caps.url}
                target="_blank"
                rel="noopener noreferrer"
                class="underline underline-offset-4">Official file</a
              >.{data!.reference.caps.stale ? ' AMFI should have a newer list by now.' : ''}
            {:else}
              AMFI cap list: not loaded.
            {/if}
            {#if data!.reference.capsFailure}Couldn’t refresh it ({data!.reference
                .capsFailure}).{/if}
          </p>
          {#if fundFailures.length}
            <div class="text-small grid gap-1">
              <p class="text-muted-foreground">
                Some fund reports couldn’t be refreshed. Funds keep any report saved earlier, with
                its own date.
              </p>
              <ul class="grid gap-1">
                {#each fundFailures as [label, messages] (label)}
                  <li class="break-words">
                    <span class="font-semibold">{label}:</span>
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
          <p class="text-muted-foreground text-small">
            As of {date(data!.date)} · Percentages in each chart use the included value shown with it.
          </p>
        {/snippet}

        {@render disclosure(
          'assets',
          'Asset split',
          lead(data.assetSplit, CLASS_NAMES),
          assetSplit,
        )}
        {@render disclosure(
          'underlying',
          'Underlying asset split',
          lead(data.lookthrough.assetSplit, CLASS_NAMES),
          underlying,
        )}
        {@render disclosure('strategy', 'Active / passive split', lead(data.strategy), strategy)}
        {@render disclosure('sectors', 'Sector allocation', lead(data.sectors), sectors)}
        {@render disclosure('caps', 'Market cap split', lead(data.marketCap), marketCap)}
        {@render disclosure('currency', 'Currency exposure', lead(data.currency), currency)}
        {@render disclosure(
          'positions',
          'Largest portfolio positions',
          `${data.holdings.count} holdings`,
          positions,
        )}
        {@render disclosure(
          'stocks',
          'Stock concentration',
          data.stocks.count ? `${data.stocks.count} stocks` : '',
          stocks,
        )}
        {@render disclosure('funds', 'Fund holdings and overlap', '', funds)}
        {@render disclosure('indices', 'Indices and benchmarks', '', indices)}
        {@render disclosure('sources', 'Data behind the analysis', '', sources)}
      {/if}
    </section>
  </div>
{/if}
