<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import FileUp from '@lucide/svelte/icons/file-up';
  import { type Analytics, FUND_SOURCES } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { ask } from '#lib/confirm.svelte.ts';
  import { readFile } from '#lib/files.ts';
  import { CLASS_NAMES, date, inr, pct } from '#lib/format.ts';
  import type { AnalyticsDto } from '#lib/worker/dto.ts';

  import { Badge } from './ui/badge/index.ts';
  import { Button, buttonVariants } from './ui/button/index.ts';
  import { Input } from './ui/input/index.ts';
  import { NativeSelect } from './ui/native-select/index.ts';
  import * as Table from './ui/table/index.ts';
  import Stat from './Stat.svelte';

  let {
    data,
    added,
    onchange,
  }: {
    data: Analytics['lookthrough'];
    /** Reports added by hand on this device. */
    added: AnalyticsDto['reference']['addedReports'];
    /** Reloads the analysis after reports are added or removed. */
    onchange: () => Promise<void>;
  } = $props();
  let adding = $state(false);
  let addMessage = $state('');
  let selectedKey = $state('');
  let query = $state('');
  let showAll = $state(false);
  const sources = new Intl.ListFormat('en-IN').format(
    Object.values(FUND_SOURCES).map((s) => s.label),
  );
  $effect(() => {
    if (!data.funds.some((f) => f.key === selectedKey)) {
      selectedKey = data.funds[0]?.key ?? '';
    }
  });
  const selected = $derived(data.funds.find((f) => f.key === selectedKey));
  const filtered = $derived(
    selected?.constituents.filter((c) =>
      `${c.name} ${c.isin ?? ''}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [],
  );
  const rows = $derived(showAll ? filtered : filtered.slice(0, 20));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  async function addReport(input: HTMLInputElement) {
    const file = input.files?.[0];

    input.value = '';

    if (!file) {
      return;
    }

    adding = true;
    addMessage = '';

    try {
      const result = await api().addFundReport(file.name, await readFile(file));
      const used = result.funds.length
        ? `Now used for ${new Intl.ListFormat('en-IN').format(result.funds)}.`
        : 'None of your funds use it: their names don’t match, or a newer report is already loaded.';
      const skipped = result.skipped.length
        ? ` ${plural(result.skipped.length, 'scheme', 'schemes')} couldn’t be read (${result.skipped[0]}).`
        : '';

      addMessage = `Added ${plural(result.schemes, 'scheme', 'schemes')} as of ${date(result.asOf)}. ${used}${skipped}`;
      await onchange();
    } catch (e) {
      addMessage = (e as Error).message.replace(/^.*Error: /, '');
    } finally {
      adding = false;
    }
  }

  async function removeReports() {
    const ok = await ask({
      title: 'Remove the reports you added?',
      description: 'Funds that use them go back to fetched reports, or to unclassified.',
      action: 'Remove',
      destructive: true,
    });

    if (!ok) {
      return;
    }

    await api().removeAddedFundReports();
    addMessage = 'Removed the reports you added.';
    await onchange();
  }
</script>

<!-- Flat, as it sits in a row on Insights that already names it. -->
<div class="grid gap-5">
  <p class="text-muted-foreground text-small">
    Reported securities and weights for your mutual funds and ETFs.
  </p>
  {#if !data.funds.length}
    <p class="text-muted-foreground text-sm">No mutual funds or ETFs in this selection.</p>
  {:else}
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Stat
        label="Fund value covered"
        value={data.coverage.total ? pct(data.coverage.covered / data.coverage.total, 1) : '—'}
      />
      <Stat label="Fund value without holdings" value={inr(data.coverage.missing)} />
      <Stat label="Oldest underlying report" value={date(data.coverage.oldest ?? undefined)} />
    </div>
    <div class="grid gap-2">
      <label for="fund-portfolio" class="text-sm font-medium">Fund portfolio</label>
      <NativeSelect
        id="fund-portfolio"
        aria-label="Fund portfolio"
        bind:value={selectedKey}
        onchange={() => {
          query = '';
          showAll = false;
        }}
        class="w-full min-w-0"
      >
        {#each data.funds as fund (fund.key)}<option value={fund.key}>{fund.name}</option>{/each}
      </NativeSelect>
    </div>
    {#if selected}
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary"
          >{selected.status === 'unavailable'
            ? 'Disclosure unavailable'
            : `${pct(selected.coverage, 1)} covered`}</Badge
        >
        {#if selected.asOf}<span class="text-muted-foreground"
            >Portfolio as of {date(selected.asOf)}</span
          >{/if}
        {#if selected.stale}<Badge variant="outline">Older than 45 days</Badge>{/if}
        {#if selected.retained}<Badge variant="outline">Saved earlier</Badge>{/if}
        {#if selected.source === 'file'}<Badge variant="outline">Added by you</Badge>{/if}
        {#if selected.sourceUrl}<a
            href={selected.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-4">Official disclosure</a
          >{/if}
      </div>
      {#if selected.retained}<p class="text-muted-foreground text-sm">
          The latest refresh didn’t bring a new report for this fund, so this is the one saved
          earlier.
        </p>{/if}
      {#if selected.status === 'unavailable'}
        <p class="text-muted-foreground text-sm leading-relaxed">
          No matching report is available for this fund. Its stocks stay unclassified, and the
          underlying asset split counts it by fund type. Automatic sources currently cover {sources};
          availability depends on their published files. For another fund house, add its monthly
          portfolio below.
        </p>
      {:else}
        <Input
          type="search"
          aria-label="Search underlying holdings"
          placeholder="Search securities or ISIN"
          bind:value={query}
        />
        <Table.Root class="table-fixed sm:table-auto">
          <Table.Header
            ><Table.Row
              ><Table.Head class="w-1/2 whitespace-normal sm:w-auto">Underlying security</Table.Head
              ><Table.Head class="text-right">Weight</Table.Head><Table.Head
                class="text-right whitespace-normal">Exposure ≈</Table.Head
              ></Table.Row
            ></Table.Header
          >
          <Table.Body>
            {#each rows as row, i (row.kind + (row.isin ?? row.name) + i)}
              <Table.Row>
                <Table.Cell class="max-w-72 whitespace-normal">
                  <span class="line-clamp-2 font-medium">{row.name}</span>
                  <span class="text-muted-foreground block text-xs"
                    >{row.isin ??
                      (row.unresolved
                        ? 'Unresolved allocation'
                        : CLASS_NAMES[row.assetClass])}</span
                  >
                  {#if row.industry}<span class="text-muted-foreground block text-xs"
                      >{row.industry}</span
                    >{/if}
                </Table.Cell>
                <Table.Cell class="text-right tabular-nums">{pct(row.weight, 2)}</Table.Cell>
                <Table.Cell class="text-right whitespace-normal tabular-nums"
                  >{inr(row.value)}</Table.Cell
                >
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
        {#if filtered.length === 0}<p class="text-muted-foreground text-sm">
            No matching securities.
          </p>{/if}
        {#if filtered.length > 20}<Button
            variant="outline"
            size="sm"
            onclick={() => (showAll = !showAll)}
            >{showAll ? 'Show largest 20' : `Show all ${filtered.length} holdings`}</Button
          >{/if}
        <p class="text-muted-foreground text-xs leading-relaxed">
          Weights are percentages of reported net assets; known nested funds are expanded into
          effective weights. Exposure is your current fund value multiplied by the disclosed weight.
          Cash, debt and unresolved holdings remain separate. These are dated estimates, not today’s
          confirmed fund positions.
        </p>
        {#if selected.derivatives}<p class="text-muted-foreground text-xs leading-relaxed">
            This fund also reports derivatives. Stock weights show physical ownership and do not
            subtract hedges or measure net market risk.
          </p>{/if}
        {#if selected.warnings.length}<details class="text-muted-foreground text-xs">
            <summary class="cursor-pointer">Disclosure notes ({selected.warnings.length})</summary>
            <ul class="mt-2 grid gap-1">
              {#each selected.warnings as warning, i (i)}<li>{warning}</li>{/each}
            </ul>
          </details>{/if}
      {/if}
    {/if}
    <div class="grid gap-3 border-t pt-5">
      <div class="grid gap-1">
        <h3 class="text-sm font-medium">Add a report yourself</h3>
        <p class="text-muted-foreground text-sm leading-relaxed">
          Some fund houses, such as Axis and Edelweiss, don’t let the app fetch their reports.
          Download the monthly portfolio from the fund house’s website and add it here. It’s read
          and kept on this device only.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <FileUp />{adding ? 'Reading…' : 'Add a fund report'}
          <input
            class="sr-only"
            type="file"
            accept=".xlsx,.xls,.zip"
            disabled={adding}
            onchange={(e) => addReport(e.currentTarget)}
            data-testid="fund-report-input"
          />
        </label>
        {#if added.schemes}<Button variant="ghost" size="sm" onclick={removeReports}
            >Remove added reports</Button
          >{/if}
      </div>
      {#if added.schemes}<p class="text-muted-foreground text-xs">
          Added on this device: {plural(added.schemes, 'scheme', 'schemes')}, the newest as of {date(
            added.newest,
          )}. Add next month’s report when it’s out; the newest report of each scheme is used.
        </p>{/if}
      {#if addMessage}<p class="text-sm" role="status">{addMessage}</p>{/if}
    </div>
  {/if}
</div>

<section aria-labelledby="fund-overlap" class="mt-8 grid gap-3">
  <div class="grid gap-0.5">
    <h3 id="fund-overlap" class="text-body font-semibold">Fund overlap</h3>
    <p class="text-muted-foreground text-small">
      Common physical stock holdings across fund portfolios.
    </p>
  </div>
  {#if data.overlap.length === 0}<p class="text-muted-foreground text-sm">
      No common identified stocks found among the available fund reports.
    </p>
  {:else}
    <ul class="grid gap-3">
      {#each data.overlap as pair, i (i)}
        <li class="flex items-center gap-4 border-b pb-3 last:border-0 last:pb-0">
          <div class="min-w-0 flex-1 text-sm">
            <p class="line-clamp-2 font-medium">{pair.first}</p>
            <p class="text-muted-foreground line-clamp-2">{pair.second}</p>
          </div>
          <div class="shrink-0 text-right">
            <p class="font-semibold tabular-nums">{pct(pair.share, 1)}</p>
            <p class="text-muted-foreground text-xs">{pair.stocks} stocks</p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="text-muted-foreground text-xs leading-relaxed">
    Overlap adds the smaller weight of each shared stock. Weights use each fund’s net assets, so
    cash is not rescaled into stocks. Reports can have different dates; missing holdings and
    derivatives are excluded.
  </p>
</section>
