<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash';
  import { BILL_STATE_LABELS, type CardPayment } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app, attempt, changed, say } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Stat from '#lib/components/Stat.svelte';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
  import * as ToggleGroup from '#lib/components/ui/toggle-group/index.ts';
  import { ask } from '#lib/confirm.svelte.ts';
  import { date, inr, inrExact, pct, shortDate } from '#lib/format.ts';
  import { money, todayIso } from '#lib/forms.ts';
  import type { BillDto, CardDetailDto } from '#lib/worker/dto.ts';

  type How = 'full' | 'minimum' | 'other';

  const id = $derived(decodeURIComponent(page.params.id ?? ''));
  let detail = $state<CardDetailDto | null | undefined>(undefined);
  let how = $state<How | ''>('full');
  let last: How = 'full';
  let amount = $state('');
  let on = $state(todayIso());
  let draft = $state<{ bank: string; name: string; memberId: string; limit: string } | null>(null);

  const bill = $derived(detail?.card.bill);
  const minimumLeft = $derived(bill ? Math.max(0, bill.minimumDue - bill.paid) : 0);
  // On a narrow phone a label wraps to two lines, rather than push the form past the card's edge.
  const choice =
    'h-auto min-h-9 min-w-0 flex-1 shrink self-stretch py-1 leading-tight whitespace-normal group-data-[spacing=0]/toggle-group:px-2';

  /** Pay in full fills in what's left to pay, and Pay minimum what's left of the minimum due. */
  function fill(next: How) {
    how = last = next;
    amount =
      next === 'full'
        ? String(detail?.card.due ?? '')
        : next === 'minimum'
          ? String(minimumLeft)
          : '';
  }

  $effect(() => {
    void app.version;
    void api()
      .card(id)
      .then((d) => {
        detail = d;

        if (d) {
          fill(d.card.due > 0 ? 'full' : 'other');
        }
      });
  });

  /** Bills and payments together, newest first; a payment on a statement date comes after it. */
  const history = $derived(
    detail
      ? [
          ...detail.bills.map((b) => ({ kind: 'bill' as const, date: b.statementDate, bill: b })),
          ...detail.payments.map((p) => ({ kind: 'payment' as const, date: p.date, payment: p })),
        ].sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            Number(a.kind === 'payment') - Number(b.kind === 'payment'),
        )
      : [],
  );

  async function record(event: Event) {
    event.preventDefault();
    const done = await attempt(() =>
      api().addCardPayment({ cardId: id, amount: money(amount), date: on }),
    );

    if (done) {
      say('Saved');
      on = todayIso();
      await changed();
    }
  }

  async function removeBill(b: BillDto) {
    const yes = await ask({
      title: 'Delete this bill?',
      description: 'What’s left to pay is worked out again without it.',
      action: 'Delete',
      destructive: true,
    });

    if (yes && (await attempt(() => api().removeBill(b.id)))) {
      await changed();
    }
  }

  async function removePayment(p: CardPayment) {
    const yes = await ask({
      title: 'Delete this payment?',
      description: 'What’s left to pay is worked out again without it.',
      action: 'Delete',
      destructive: true,
    });

    if (yes && (await attempt(() => api().removeCardPayment(p.id)))) {
      await changed();
    }
  }

  async function closeOrReopen() {
    const closed = !!detail!.card.closed;
    const yes = await ask(
      closed
        ? {
            title: 'Reopen this card?',
            description: 'It goes back on your list of cards.',
            action: 'Reopen card',
          }
        : {
            title: 'Close this card?',
            description: 'It leaves your list of cards and keeps its history. You can reopen it.',
            action: 'Close card',
          },
    );

    if (
      yes &&
      (await attempt(() => (closed ? api().reopenCard(id) : api().closeCard(id, todayIso()))))
    ) {
      say(closed ? 'Reopened' : 'Closed');
      await changed();
    }
  }

  async function removeCard() {
    const yes = await ask({
      title: 'Delete this card?',
      description:
        'Its bills and payments go too, as if it never existed. To keep its history, close it instead.',
      action: 'Delete',
      destructive: true,
    });

    if (yes && (await attempt(() => api().removeCard(id)))) {
      say('Deleted');
      await changed();
      await goto('#/cards');
    }
  }

  function edit() {
    const c = detail!.card;

    draft = { bank: c.bank, name: c.name, memberId: c.memberId, limit: String(c.limit ?? '') };
  }

  async function saveDetails(event: Event) {
    event.preventDefault();
    const d = draft!;
    const done = await attempt(() =>
      api().saveCard({
        id,
        memberId: d.memberId,
        bank: d.bank,
        name: d.name,
        ...(d.limit.trim() ? { limit: money(d.limit) } : {}),
      }),
    );

    if (done) {
      draft = null;
      say('Saved');
      await changed();
    }
  }

  const amountText = (n: number) => (Number.isInteger(n) ? inr(n) : inrExact(n));
</script>

{#if detail === undefined}
  <Skeleton class="h-10 w-48 rounded-2xl" />
  <Skeleton class="h-40 rounded-4xl" />
{:else if detail === null}
  <PageHeader title="Not found" back={{ href: '#/cards', label: 'Cards' }} />
  <p class="text-muted-foreground text-sm">This card no longer exists.</p>
{:else}
  {@const c = detail.card}
  <PageHeader
    title={c.name}
    amounts
    back={{ href: '#/cards', label: 'Cards' }}
    description={[
      c.bank,
      app.members.length > 1 && c.memberName,
      c.closed
        ? `Closed ${date(c.closed)}`
        : c.overdue
          ? `Overdue since ${date(c.bill?.dueDate)}`
          : c.due > 0 && `Due ${date(c.bill?.dueDate)}`,
    ]
      .filter(Boolean)
      .join(' · ')}
  >
    {#snippet actions()}
      <Button size="sm" href={`#/cards/bill?card=${encodeURIComponent(id)}`}
        ><Plus />Add a bill</Button
      >
    {/snippet}
  </PageHeader>

  <Card.Root>
    {#if bill}
      <Card.Content class="grid grid-cols-2 gap-5 sm:grid-cols-3">
        <Stat label="Left to pay" value={inr(c.due)} testid="card-due" />
        <Stat
          label="Bill"
          value={inr(bill.amount)}
          hint={`Statement ${date(bill.statementDate)}`}
        />
        <Stat label="Minimum due" value={inr(bill.minimumDue)} />
        <Stat
          label="Paid so far"
          value={inr(bill.paid)}
          hint={c.credit > 0 ? `${inr(c.credit)} in credit` : undefined}
        />
        <Stat
          label="Due date"
          value={date(bill.dueDate)}
          tone={c.overdue ? 'loss' : undefined}
          hint={c.overdue ? 'Overdue' : BILL_STATE_LABELS[bill.state]}
          testid="card-status"
        />
        {#if c.limit}
          <Stat label="Limit used" value={pct(c.limitUsed, 0)} hint={`Of ${inr(c.limit)}`} />
        {/if}
      </Card.Content>
    {:else}
      <Card.Content class="grid gap-3">
        <p class="text-muted-foreground text-sm">No bill yet. Add one to see what’s left to pay.</p>
        <Button href={`#/cards/bill?card=${encodeURIComponent(id)}`} class="justify-self-start"
          >Add a bill</Button
        >
      </Card.Content>
    {/if}
  </Card.Root>

  <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
    {#if bill}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg font-semibold">Record a payment</Card.Title>
          <Card.Description>Part payments are fine.</Card.Description>
        </Card.Header>
        <Card.Content>
          <form class="grid gap-4" onsubmit={record}>
            <ToggleGroup.Root
              type="single"
              variant="outline"
              bind:value={how}
              onValueChange={(v) => (v ? fill(v as How) : (how = last))}
              aria-label="How much"
              class="w-full sm:w-auto"
            >
              <ToggleGroup.Item value="full" class={choice} disabled={c.due <= 0}
                >Pay in full</ToggleGroup.Item
              >
              <ToggleGroup.Item value="minimum" class={choice} disabled={minimumLeft <= 0}
                >Pay minimum</ToggleGroup.Item
              >
              <ToggleGroup.Item value="other" class={choice}>Other amount</ToggleGroup.Item>
            </ToggleGroup.Root>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Amount (₹)">
                <Input
                  inputmode="decimal"
                  bind:value={amount}
                  oninput={() => (how = last = 'other')}
                  required
                />
              </FormField>
              <FormField
                label="Paid on"
                hint={on === bill.statementDate
                  ? 'A payment on the statement date is already in this bill, so it counts toward the one before.'
                  : undefined}
              >
                <Input type="date" bind:value={on} required />
              </FormField>
            </div>
            <Button type="submit" class="sm:justify-self-start">Save</Button>
          </form>
        </Card.Content>
      </Card.Root>
    {/if}

    <Card.Root>
      <Card.Header><Card.Title class="text-lg font-semibold">History</Card.Title></Card.Header>
      <Card.Content class="grid px-2 sm:px-4">
        {#each history as h (h.kind === 'bill' ? h.bill.id : h.payment.id)}
          {#if h.kind === 'bill'}
            {@const b = h.bill}
            <div class="flex min-w-0 items-center gap-3 px-3 py-2" data-testid="card-bill">
              <span class="min-w-0 flex-1">
                <span class="flex min-w-0 items-center gap-2">
                  <span class="truncate text-sm font-medium">Bill</span>
                  {#if b.overdue}
                    <Badge variant="destructive">Overdue</Badge>
                  {:else}
                    <Badge variant="secondary">{BILL_STATE_LABELS[b.state]}</Badge>
                  {/if}
                </span>
                <span class="text-muted-foreground block truncate text-xs"
                  >{shortDate(b.statementDate)} · due {shortDate(b.dueDate)}</span
                >
              </span>
              <span class="shrink-0 text-sm tabular-nums">{amountText(b.amount)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete the bill of ${date(b.statementDate)}`}
                class="text-muted-foreground hover:text-destructive shrink-0"
                onclick={() => removeBill(b)}><Trash /></Button
              >
            </div>
          {:else}
            {@const p = h.payment}
            <div class="flex min-w-0 items-center gap-3 px-3 py-2" data-testid="card-payment">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">Payment</span>
                <span class="text-muted-foreground block text-xs">{shortDate(p.date)}</span>
              </span>
              <span class="shrink-0 text-sm tabular-nums">{amountText(p.amount)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete the payment of ${date(p.date)}`}
                class="text-muted-foreground hover:text-destructive shrink-0"
                onclick={() => removePayment(p)}><Trash /></Button
              >
            </div>
          {/if}
        {:else}
          <p class="text-muted-foreground px-3 py-2 text-sm">Nothing yet.</p>
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
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Bank"><Input bind:value={draft.bank} required /></FormField>
            <FormField label="Name"><Input bind:value={draft.name} required /></FormField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {#if app.members.length > 1}
              <FormField label="Whose?">
                <NativeSelect bind:value={draft.memberId} class="w-full">
                  {#each app.members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
                </NativeSelect>
              </FormField>
            {/if}
            <FormField label="Credit limit (₹, optional)">
              <Input inputmode="decimal" bind:value={draft.limit} />
            </FormField>
          </div>
          <Button type="submit" class="justify-self-start">Save</Button>
        </form>
      {:else}
        <p class="text-muted-foreground text-sm">
          {c.limit ? `Credit limit ${inr(c.limit)}` : 'No credit limit set.'}
        </p>
      {/if}
    </Card.Content>
    <Card.Footer class="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onclick={closeOrReopen}
        >{c.closed ? 'Reopen card' : 'Close card'}</Button
      >
      <Button
        variant="ghost"
        size="sm"
        class="text-destructive hover:text-destructive"
        onclick={removeCard}><Trash />Delete card</Button
      >
    </Card.Footer>
  </Card.Root>
{/if}
