<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import {
    DEFAULT_MONTHS,
    emergencyFund,
    type EmergencyMoney,
    type EmergencySettings,
    MAX_MONTHS,
  } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import { inr } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';

  import { Button } from './ui/button/index.ts';
  import * as Card from './ui/card/index.ts';
  import { Input } from './ui/input/index.ts';
  import FormField from './FormField.svelte';

  let {
    money,
    saved,
    memberId,
    onsave,
  }: {
    money: EmergencyMoney;
    saved: EmergencySettings | null;
    memberId?: string;
    onsave?: (settings: EmergencySettings) => void;
  } = $props();
  let expenses = $state<number | null>(null);
  let months = $state(DEFAULT_MONTHS);
  let saving = $state(false);
  let message = $state('');
  let error = $state('');
  $effect(() => {
    // A different member brings what's saved for them.
    expenses = saved?.monthlyExpenses ?? null;
    months = saved?.months ?? DEFAULT_MONTHS;
  });
  $effect(() => {
    // Kept apart, so saving (which updates `saved`) doesn't clear its own message.
    void memberId;
    message = '';
    error = '';
  });
  const settings = $derived({ monthlyExpenses: expenses ?? 0, months });
  const fund = $derived(emergencyFund(money, settings));
  const covered = $derived(fund.target > 0 ? Math.min(1, fund.available / fund.target) : 0);
  const monthsFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
  const rows = $derived([
    ['Bank / cash', money.cash],
    ['Liquid and money market funds', money.cashFunds],
    ['Fixed deposits', money.deposits],
  ] as const);
  async function save() {
    saving = true;
    error = '';
    message = '';

    try {
      await api().saveEmergencyFund($state.snapshot(settings), memberId);
      onsave?.($state.snapshot(settings));
      message = 'Saved for this selection.';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Emergency fund</Card.Title>
    <Card.Description>How long the money you can reach quickly would last.</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-5">
    <div class="grid grid-cols-2 gap-3">
      <FormField label="Monthly expenses (₹)">
        <Input
          type="number"
          min="0"
          step="1000"
          bind:value={expenses}
          oninput={() => (message = '')}
        />
      </FormField>
      <FormField label="Months to keep">
        <Input
          type="number"
          min="1"
          max={MAX_MONTHS}
          step="1"
          bind:value={months}
          oninput={() => (message = '')}
        />
      </FormField>
    </div>

    {#if fund.valid}
      <div class="grid gap-2">
        <p class="text-2xl font-semibold tabular-nums" data-testid="emergency-months">
          {monthsFmt.format(fund.months)}
          {fund.months === 1 ? 'month' : 'months'}
          <span class="text-muted-foreground text-sm font-normal">of {months} you want</span>
        </p>
        <div
          class="bg-muted h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Emergency fund"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(covered * 100)}
        >
          <div
            class={cn('h-full rounded-full', fund.shortfall > 0 ? 'bg-amber-500' : 'bg-gain')}
            style:width={`${covered * 100}%`}
          ></div>
        </div>
        <p
          class={cn(
            'text-sm',
            fund.shortfall > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gain',
          )}
        >
          {fund.shortfall > 0
            ? `Short by ${inr(fund.shortfall)} of ${inr(fund.target)}.`
            : `Covered, with ${inr(fund.spare)} more than ${inr(fund.target)}.`}
        </p>
      </div>
    {:else}
      <p class="text-muted-foreground text-sm">
        {expenses
          ? `Months to keep must be from 1 to ${MAX_MONTHS}.`
          : 'Enter your monthly expenses to see how long this would last.'}
      </p>
    {/if}

    <dl class="grid gap-2 text-sm">
      {#each rows as [label, value] (label)}
        <div class="flex justify-between gap-3">
          <dt class="text-muted-foreground">{label}</dt>
          <dd class="tabular-nums">{inr(value)}</dd>
        </div>
      {/each}
      <div class="flex justify-between gap-3 border-t pt-2 font-medium">
        <dt>Counted</dt>
        <dd class="tabular-nums">{inr(fund.available)}</dd>
      </div>
    </dl>

    <div class="flex flex-wrap items-center gap-3">
      <Button onclick={save} disabled={!fund.valid || saving || app.vault?.readOnly}
        >{saving ? 'Saving…' : 'Save'}</Button
      >
      {#if message}<p class="text-sm" role="status">{message}</p>{/if}
      {#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
    </div>
    <p class="text-muted-foreground text-xs leading-relaxed">
      Counts bank balances, funds with asset class Cash (liquid, overnight and money market funds by
      default) and fixed deposits, which you can usually break within a day or two. Other debt
      funds, bonds, gold, stocks, provident funds and money you’ve lent aren’t counted. Card bills
      aren’t taken off, since your monthly expenses already cover what you spend on cards.
    </p>
  </Card.Content>
</Card.Root>
