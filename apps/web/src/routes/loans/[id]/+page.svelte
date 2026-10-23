<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Trash from '@lucide/svelte/icons/trash';

  import { api } from '#lib/api.ts';
  import { app, attempt, changed, say } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import * as Alert from '#lib/components/ui/alert/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import { ask } from '#lib/confirm.svelte.ts';
  import { date, inr, inrExact } from '#lib/format.ts';
  import { money, todayIso } from '#lib/forms.ts';
  import { LOAN_WORDS } from '#lib/loans.ts';
  import type { LoanDetailDto } from '#lib/worker/dto.ts';

  const id = $derived(decodeURIComponent(page.params.id ?? ''));
  let detail = $state<LoanDetailDto | null | undefined>(undefined);
  let type = $state<'repayment' | 'advance'>('repayment');
  let amount = $state('');
  let on = $state(todayIso());
  let draft = $state<{ party: string; memberId: string; due: string; note: string } | null>(null);

  $effect(() => {
    void app.version;
    void api()
      .loan(id)
      .then((d) => {
        detail = d;

        // Nothing can be paid back on a settled loan, only added.
        if (d && !d.loan.open) {
          type = 'advance';
        }
      });
  });

  async function record(event: Event) {
    event.preventDefault();
    const done = await attempt(() =>
      api().addLoanEntry({ loanId: id, type, amount: money(amount), date: on }),
    );

    if (done) {
      say('Saved');
      amount = '';
      await changed();
    }
  }

  async function close(how: 'repayment' | 'write-off') {
    const l = detail!.loan;
    const words = LOAN_WORDS[l.direction];
    const yes = await ask(
      how === 'repayment'
        ? {
            title: 'Settle in full?',
            description: `This records ${inr(l.balance)} ${words.entry.repayment.toLowerCase()} today, and the loan closes.`,
            action: 'Settle',
          }
        : {
            title: 'Write off the rest?',
            description: `${inr(l.balance)} won’t be paid back. The loan closes and its history stays.`,
            action: 'Write off',
            destructive: true,
          },
    );

    if (yes && (await attempt(() => api().closeLoan(id, how, todayIso())))) {
      say(how === 'repayment' ? 'Settled' : 'Written off');
      await changed();
    }
  }

  async function removeEntry(entryId: string) {
    const yes = await ask({
      title: 'Delete this entry?',
      description: 'The balance is worked out again without it.',
      action: 'Delete',
      destructive: true,
    });

    if (yes && (await attempt(() => api().removeLoanEntry(entryId)))) {
      await changed();
    }
  }

  async function removeLoan() {
    const yes = await ask({
      title: 'Delete this loan?',
      description:
        'Its whole history goes too, as if it never existed. To close a loan, settle it or write it off instead.',
      action: 'Delete',
      destructive: true,
    });

    if (yes && (await attempt(() => api().removeLoan(id)))) {
      say('Deleted');
      await changed();
      await goto('#/loans');
    }
  }

  function edit() {
    const l = detail!.loan;

    draft = { party: l.party, memberId: l.memberId, due: l.due ?? '', note: l.note ?? '' };
  }

  async function saveDetails(event: Event) {
    event.preventDefault();
    const l = detail!.loan;
    const d = draft!;
    const done = await attempt(() =>
      api().saveLoan({
        id: l.id,
        direction: l.direction,
        memberId: d.memberId,
        party: d.party,
        ...(d.due ? { due: d.due } : {}),
        ...(d.note.trim() ? { note: d.note } : {}),
      }),
    );

    if (done) {
      draft = null;
      say('Saved');
      await changed();
    }
  }
</script>

{#if detail === undefined}
  <Skeleton class="h-10 w-48 rounded-2xl" />
  <Skeleton class="h-40 rounded-4xl" />
{:else if detail === null}
  <PageHeader title="Not found" back={{ href: '#/loans', label: 'Loans' }} />
  <p class="text-muted-foreground text-sm">This loan no longer exists.</p>
{:else}
  {@const l = detail.loan}
  {@const words = LOAN_WORDS[l.direction]}
  <PageHeader
    title={l.party}
    back={{ href: '#/loans', label: 'Loans' }}
    description={[
      words.section,
      app.members.length > 1 && l.memberName,
      l.open
        ? l.overdue
          ? `Overdue since ${date(l.due)}`
          : l.due && `Due ${date(l.due)}`
        : l.settled && `${l.writtenOff > 0 ? 'Written off' : 'Settled'} ${date(l.settled)}`,
    ]
      .filter(Boolean)
      .join(' · ')}
  />

  <Card.Root>
    <Card.Content class="grid grid-cols-2 gap-5 sm:grid-cols-4">
      <Stat label="Still owed" value={inr(Math.max(0, l.balance))} testid="loan-balance" />
      <Stat label={words.total} value={inr(l.advanced)} hint={l.start && `From ${date(l.start)}`} />
      <Stat label={words.entry.repayment} value={inr(l.repaid)} />
      {#if l.writtenOff > 0}
        <Stat label="Written off" value={inr(l.writtenOff)} />
      {:else}
        <Stat
          label="Due"
          value={l.due ? date(l.due) : 'No date'}
          tone={l.overdue ? 'loss' : undefined}
        />
      {/if}
    </Card.Content>
  </Card.Root>

  {#if l.balance < -0.005}
    <Alert.Root>
      <CircleAlert />
      <Alert.Title>Paid back {inr(-l.balance)} more than {words.total.toLowerCase()}</Alert.Title>
      <Alert.Description>Delete the extra entry below.</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="grid items-start gap-4 lg:grid-cols-2">
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-lg font-semibold">Record a payment</Card.Title>
        <Card.Description>Part payments are fine.</Card.Description>
      </Card.Header>
      <Card.Content>
        <form class="grid gap-4" onsubmit={record}>
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField label="What happened?">
              <NativeSelect bind:value={type} class="w-full">
                {#if l.open}<option value="repayment">{words.entry.repayment}</option>{/if}
                <option value="advance">{words.more}</option>
              </NativeSelect>
            </FormField>
            <FormField
              label="Amount (₹)"
              hint={type === 'repayment' ? `Up to ${inr(l.balance)}` : undefined}
            >
              <Input inputmode="decimal" bind:value={amount} required />
            </FormField>
          </div>
          <FormField label="Date"><Input type="date" bind:value={on} required /></FormField>
          <Button type="submit" class="sm:justify-self-start">Save</Button>
        </form>
      </Card.Content>
      {#if l.open}
        <Card.Footer class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onclick={() => close('repayment')}
            >Settle in full</Button
          >
          <Button variant="ghost" size="sm" onclick={() => close('write-off')}>Write off</Button>
        </Card.Footer>
      {/if}
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title class="text-lg font-semibold">History</Card.Title></Card.Header>
      <Card.Content class="grid px-2 sm:px-4">
        {#each detail.entries as e (e.id)}
          <div class="flex min-w-0 items-center gap-3 px-3 py-2" data-testid="loan-entry">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{words.entry[e.type]}</span>
              <span class="text-muted-foreground block text-xs">{date(e.date)}</span>
            </span>
            <span class="shrink-0 text-sm tabular-nums"
              >{Number.isInteger(e.amount) ? inr(e.amount) : inrExact(e.amount)}</span
            >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${words.entry[e.type].toLowerCase()} of ${date(e.date)}`}
              class="text-muted-foreground hover:text-destructive shrink-0"
              onclick={() => removeEntry(e.id)}><Trash /></Button
            >
          </div>
        {/each}
      </Card.Content>
    </Card.Root>
  </div>

  <Card.Root class="max-w-2xl">
    <Card.Header>
      <Card.Title class="text-lg font-semibold">Details</Card.Title>
      <Card.Action>
        <Button variant="ghost" size="sm" onclick={() => (draft ? (draft = null) : edit())}
          >{draft ? 'Cancel' : 'Edit'}</Button
        >
      </Card.Action>
    </Card.Header>
    <Card.Content>
      {#if draft}
        <form class="grid gap-4" onsubmit={saveDetails}>
          <FormField label="Who"><Input bind:value={draft.party} required /></FormField>
          {#if app.members.length > 1}
            <FormField label="Whose?">
              <NativeSelect bind:value={draft.memberId} class="w-full">
                {#each app.members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
              </NativeSelect>
            </FormField>
          {/if}
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField label="Due by (optional)">
              <Input type="date" bind:value={draft.due} />
            </FormField>
            <FormField label="Note (optional)"><Input bind:value={draft.note} /></FormField>
          </div>
          <Button type="submit" class="justify-self-start">Save</Button>
        </form>
      {:else}
        <p class="text-muted-foreground text-sm">{l.note || 'No note.'}</p>
      {/if}
    </Card.Content>
    <Card.Footer>
      <Button
        variant="ghost"
        size="sm"
        class="text-destructive hover:text-destructive"
        onclick={removeLoan}><Trash />Delete loan</Button
      >
    </Card.Footer>
  </Card.Root>
{/if}
