<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { page } from '$app/state';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash';
  import type { AssetClass, Group, Instrument } from '@pv/core';

  import { api, list } from '#lib/api.ts';
  import { app, attempt, changed, say } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import ValueChart from '#lib/components/ValueChart.svelte';
  import { ask } from '#lib/confirm.svelte.ts';
  import { CLASS_NAMES, date, inr, inrExact, inrSigned, pct, units } from '#lib/format.ts';
  import { updatesByBalance } from '#lib/forms.ts';
  import type { HoldingDetailDto } from '#lib/worker/dto.ts';

  const key = $derived(decodeURIComponent(page.params.key ?? ''));
  let detail = $state<HoldingDetailDto | null | undefined>(undefined);
  let instrument = $state<Instrument | null>(null);
  let editing = $state(false);
  let groups = $state<Group[]>([]);

  $effect(() => {
    void app.version;
    void api()
      .holding(key)
      .then(async (d) => {
        detail = d;
        instrument = d
          ? ((await list('instrument')).find((i) => i.id === d.holding.instrumentId) ?? null)
          : null;
        groups = await list('group');
      });
  });

  async function saveInstrument(event: Event) {
    event.preventDefault();

    if (!instrument) {
      return;
    }

    const clean = $state.snapshot(instrument);

    clean.ids = Object.fromEntries(
      Object.entries(clean.ids).filter(([, v]) => v),
    ) as Instrument['ids'];

    if ((await attempt(() => api().save('instrument', clean))) !== undefined) {
      editing = false;
      say('Saved');
      await changed();
    }
  }

  function inGroup(g: Group): boolean {
    return (
      !!detail &&
      g.holdings.some(
        (x) =>
          x.instrumentId === detail!.holding.instrumentId &&
          (!x.accountId || x.accountId === detail!.holding.accountId),
      )
    );
  }

  async function toggleGroup(g: Group) {
    if (!detail) {
      return;
    }

    const { accountId, instrumentId } = detail.holding;
    const holdings = inGroup(g)
      ? g.holdings.filter(
          (x) => !(x.instrumentId === instrumentId && (!x.accountId || x.accountId === accountId)),
        )
      : [...g.holdings, { accountId, instrumentId }];

    await attempt(() => api().save('group', { ...$state.snapshot(g), holdings }));
    await changed();
  }

  async function removeTxn(id: string) {
    const ok = await ask({
      title: 'Delete this transaction?',
      description: 'The holding is recalculated without it.',
      action: 'Delete',
      destructive: true,
    });

    if (!ok) {
      return;
    }

    await attempt(() => api().remove('transaction', id));
    await changed();
  }

  // An EPF passbook keeps the employee's and the employer's shares apart.
  const SHARES: Record<string, string> = { employee: 'employee share', employer: 'employer share' };
</script>

{#if detail === undefined}
  <Skeleton class="h-10 w-48 rounded-2xl" />
  <Skeleton class="h-40 rounded-4xl" />
{:else if detail === null}
  <PageHeader title="Not found" back={{ href: '#/holdings', label: 'Holdings' }} />
  <p class="text-muted-foreground text-sm">This holding no longer exists.</p>
{:else}
  {@const h = detail.holding}
  {@const byBalance =
    instrument &&
    updatesByBalance(
      instrument.kind,
      detail.entries.some((e) => !e.synthetic),
    )}
  {#snippet updateBalance()}
    <Button size="sm" href={`#/holdings/add/balance?ref=${encodeURIComponent(h.key)}`}
      ><Pencil />Update balance</Button
    >
  {/snippet}
  <PageHeader
    title={h.name}
    amounts
    back={{ href: '#/holdings', label: 'Holdings' }}
    description={`${h.memberName} · ${h.accountLabel} · ${CLASS_NAMES[h.assetClass]}${h.status !== 'open' ? ` · ${h.status}` : ''}`}
    actions={byBalance ? updateBalance : undefined}
  />

  <Card.Root>
    <Card.Content class="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Value" value={inr(h.value)} testid="holding-value" />
      <Stat label="Invested" value={inr(h.invested)} />
      <Stat
        label="Gain"
        value={inrSigned(h.gain)}
        hint={pct(h.gainPct, 2, true)}
        tone={h.gain >= 0 ? 'gain' : 'loss'}
      />
      <Stat
        label="XIRR"
        value={pct(h.xirr)}
        testid="holding-xirr"
        hint={h.xirr === null
          ? 'Shown once it’s a year old'
          : h.xirrAsOf
            ? `From your holdings file of ${date(h.xirrAsOf)}`
            : h.xirrTo
              ? `To the interest credited ${date(h.xirrTo)}`
              : h.xirrEstimate
                ? `≈ since ${date(h.firstDate)}`
                : undefined}
      />
      {#if h.units !== null}
        <Stat label="Units" value={units(h.units)} />
        <Stat
          label="Price"
          value={inrExact(h.price)}
          hint={h.priceDate ? date(h.priceDate) : 'no price yet'}
        />
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header><Card.Title class="text-lg font-semibold">Value over time</Card.Title></Card.Header
    >
    <Card.Content><ValueChart points={detail.history} /></Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="text-lg font-semibold">Transactions</Card.Title>
      <Card.Action>
        <Button
          variant="outline"
          size="sm"
          href={`#/holdings/add/transaction?ref=${encodeURIComponent(h.key)}`}><Plus />Add</Button
        >
      </Card.Action>
    </Card.Header>
    <Card.Content class="px-3 sm:px-6">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Date</Table.Head>
            <Table.Head>Type</Table.Head>
            <Table.Head class="text-right">Units</Table.Head>
            <Table.Head class="text-right">Amount</Table.Head>
            <Table.Head class="w-10"><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each detail.entries as e (e.id)}
            {@const note = e.synthetic ? 'from an imported balance' : SHARES[e.meta?.part ?? '']}
            <Table.Row>
              <Table.Cell class="whitespace-nowrap">{date(e.date)}</Table.Cell>
              <Table.Cell
                >{e.type}{#if note}<span class="text-muted-foreground block text-xs">{note}</span
                  >{/if}</Table.Cell
              >
              <Table.Cell class="text-right tabular-nums"
                >{e.units !== undefined ? units(e.units) : ''}</Table.Cell
              >
              <Table.Cell class="text-right tabular-nums">{inrExact(e.amount)}</Table.Cell>
              <Table.Cell>
                {#if !e.synthetic}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    class="text-muted-foreground hover:text-destructive"
                    onclick={() => removeTxn(e.id)}><Trash /></Button
                  >
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>

  {#if detail.lots.length > 1}
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-lg font-semibold">Lots</Card.Title>
        <Card.Description>First in, first out.</Card.Description>
      </Card.Header>
      <Card.Content class="px-3 sm:px-6">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Bought</Table.Head>
              <Table.Head class="text-right">Units</Table.Head>
              <Table.Head class="text-right">Cost</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each detail.lots as lot, i (i)}
              <Table.Row>
                <Table.Cell>{date(lot.date)}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{units(lot.units)}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{inr(lot.costInr)}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Content>
    </Card.Root>
  {/if}

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    {#if groups.length}
      <Card.Root>
        <Card.Header><Card.Title class="text-lg font-semibold">Groups</Card.Title></Card.Header>
        <Card.Content class="grid gap-3">
          {#each groups as g (g.id)}
            <label class="flex items-center gap-3 text-sm">
              <Checkbox checked={inGroup(g)} onCheckedChange={() => toggleGroup(g)} />
              {g.name}
            </label>
          {/each}
        </Card.Content>
      </Card.Root>
    {/if}

    {#if instrument}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg font-semibold">Details</Card.Title>
          <Card.Action>
            <Button variant="ghost" size="sm" onclick={() => (editing = !editing)}
              >{editing ? 'Cancel' : 'Edit'}</Button
            >
          </Card.Action>
        </Card.Header>
        <Card.Content>
          {#if editing}
            <form class="grid gap-4" onsubmit={saveInstrument}>
              <FormField label="Name"><Input bind:value={instrument.name} /></FormField>
              <FormField label="Asset class">
                <NativeSelect bind:value={instrument.assetClass} class="w-full">
                  {#each Object.entries(CLASS_NAMES) as [k, label] (k)}<option
                      value={k as AssetClass}>{label}</option
                    >{/each}
                </NativeSelect>
              </FormField>
              <FormField label="ISIN"><Input bind:value={instrument.ids.isin} /></FormField>
              <FormField label="AMFI scheme code (mutual funds)">
                <Input bind:value={instrument.ids.amfi} inputmode="numeric" />
              </FormField>
              <FormField label="NSE symbol"><Input bind:value={instrument.ids.nse} /></FormField>
              <Button type="submit" class="justify-self-start">Save</Button>
            </form>
          {:else}
            <p class="text-muted-foreground text-sm">
              {Object.entries(instrument.ids)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k.toUpperCase()} ${v}`)
                .join(' · ') || 'Not linked to a price source. Edit to add its ISIN or AMFI code.'}
            </p>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}
  </div>
{/if}
