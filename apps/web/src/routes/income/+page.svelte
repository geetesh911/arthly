<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import * as Tabs from '#lib/components/ui/tabs/index.ts';
  import { fyLabel, inr } from '#lib/format.ts';

  type Row = Awaited<ReturnType<ReturnType<typeof api>['income']>>[number];
  let years = $state<number[]>([]);
  let fy = $state<number | null>(null);
  let tab = $state<'interest' | 'dividend'>('interest');
  let rows = $state<Row[]>([]);

  onMount(async () => {
    years = await api().incomeYears();
    fy = years[0] ?? null;
  });

  $effect(() => {
    void app.version;

    if (fy !== null) {
      void api()
        .income(fy)
        .then((r) => (rows = r));
    }
  });

  const shown = $derived(
    rows.filter(
      (r) => r.type === tab && (!app.filter.memberId || r.memberId === app.filter.memberId),
    ),
  );
  const totals = $derived({
    received: shown.reduce((s, r) => s + r.received, 0),
    accrued: shown.reduce((s, r) => s + r.accrued, 0),
  });
</script>

<PageHeader title="Income" back={{ href: '#/more', label: 'More' }} backClass="lg:hidden" amounts>
  {#snippet actions()}
    <NativeSelect bind:value={fy} aria-label="Financial year" size="sm">
      {#each years as y (y)}<option value={y}>{fyLabel(y)}</option>{/each}
    </NativeSelect>
  {/snippet}
</PageHeader>

<Tabs.Root bind:value={tab}>
  <Tabs.List>
    <Tabs.Trigger value="interest">Interest</Tabs.Trigger>
    <Tabs.Trigger value="dividend">Dividends</Tabs.Trigger>
  </Tabs.List>
</Tabs.Root>

<Card.Root>
  <Card.Content class="px-3 sm:px-6">
    {#if shown.length === 0}
      <p class="text-muted-foreground px-3 text-sm sm:px-0">Nothing for this year.</p>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Holding</Table.Head>
            <Table.Head class="text-right">Received</Table.Head>
            <Table.Head class="text-right">Earned</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown as r (r.accountId + r.instrumentId + r.type)}
            <Table.Row>
              <Table.Cell class="whitespace-normal">
                {r.name}
                <span class="text-muted-foreground block text-xs"
                  >{r.memberName}{r.taxFree ? ' · tax-free' : ''}{r.estimated
                    ? ' · includes estimates'
                    : ''}{r.tds ? ` · TDS ${inr(r.tds)}` : ''}</span
                >
              </Table.Cell>
              <Table.Cell class="text-right tabular-nums">{inr(r.received)}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{inr(r.accrued)}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
        <Table.Footer>
          <Table.Row>
            <Table.Head>Total</Table.Head>
            <Table.Head class="text-right tabular-nums">{inr(totals.received)}</Table.Head>
            <Table.Head class="text-right tabular-nums">{inr(totals.accrued)}</Table.Head>
          </Table.Row>
        </Table.Footer>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>
<p class="text-muted-foreground text-xs">
  "Received" is what was paid out or credited during the year; "Earned" is the interest that built
  up during it. A summary for your records, not tax advice.
</p>
