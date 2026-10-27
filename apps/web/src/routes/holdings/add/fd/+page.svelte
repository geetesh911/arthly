<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { addYears, type Compounding, type Payout, randomId } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app, attempt, changed, say } from '#lib/app.svelte.ts';
  import { backLink } from '#lib/back.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { ensureAccount, money, newInstrument, todayIso } from '#lib/forms.ts';

  const back = backLink({ href: '#/holdings', label: 'Holdings' });
  let kind = $state<'fd' | 'bond' | 'sgb'>('fd');
  let memberId = $state(app.filter.memberId ?? app.members[0]?.id ?? '');
  let institution = $state('');
  let name = $state('');
  let principal = $state('');
  let start = $state(todayIso());
  let maturity = $state(addYears(todayIso(), 1));
  let ratePct = $state('');
  let compounding = $state<Compounding>('quarterly');
  let payout = $state<Payout>('cumulative');
  let units = $state('');
  let price = $state('');
  let faceValue = $state('');
  let couponPct = $state('2.5');
  let couponFreq = $state<1 | 2 | 4 | 12>(2);
  let isin = $state('');

  async function save(event: Event) {
    event.preventDefault();
    const done = await attempt(async () => {
      if (kind === 'fd') {
        const accountId = await ensureAccount({
          memberId,
          institution,
          kind: 'bank',
          label: institution,
        });
        const instrumentId = await newInstrument({
          kind: 'fd',
          name: name || `${institution} FD ${ratePct}%`,
          terms: {
            principal: money(principal),
            start,
            maturity,
            ratePct: Number(ratePct),
            compounding,
            payout,
          },
        });

        await api().save('transaction', {
          id: randomId('txn'),
          accountId,
          instrumentId,
          date: start,
          type: 'contribution',
          amount: money(principal),
          currency: 'INR',
          source: { kind: 'manual' },
        });

        return `${accountId}|${instrumentId}`;
      }

      const accountId = await ensureAccount({
        memberId,
        institution,
        kind: 'demat',
        label: institution,
      });
      const instrumentId = await newInstrument({
        kind,
        name,
        ids: isin ? { isin: isin.toUpperCase() } : {},
        terms: {
          faceValue: money(faceValue || price),
          couponPct: Number(couponPct),
          couponFreq,
          issue: start,
          maturity,
        },
      });

      await api().save('transaction', {
        id: randomId('txn'),
        accountId,
        instrumentId,
        date: start,
        type: 'buy',
        units: Number(units),
        price: Number(price),
        amount: money(Number(units) * Number(price)),
        currency: 'INR',
        source: { kind: 'manual' },
      });

      return `${accountId}|${instrumentId}`;
    });

    if (done) {
      say('Saved');
      await changed();
      await goto(`#/holdings/${encodeURIComponent(done)}`);
    }
  }
</script>

<PageHeader title="Add an FD, bond or SGB" back={back.current} />
<Card.Root class="max-w-2xl">
  <Card.Content>
    <form class="grid gap-4" onsubmit={save}>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="What is it?">
          <NativeSelect
            bind:value={kind}
            class="w-full"
            onchange={() => {
              if (kind === 'sgb') {
                couponPct = '2.5';
                couponFreq = 2;
                maturity = addYears(start, 8);
              }
            }}
          >
            <option value="fd">Fixed deposit</option>
            <option value="bond">Bond</option>
            <option value="sgb">Sovereign Gold Bond</option>
          </NativeSelect>
        </FormField>
        {#if app.members.length > 1}
          <FormField label="Whose?">
            <NativeSelect bind:value={memberId} class="w-full">
              {#each app.members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
            </NativeSelect>
          </FormField>
        {/if}
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={kind === 'fd' ? 'Bank' : 'Held with (broker or bank)'}>
          <Input
            bind:value={institution}
            required
            placeholder={kind === 'fd' ? 'Bank of Baroda' : 'Groww'}
          />
        </FormField>
        <FormField label="Name">
          <Input
            bind:value={name}
            required={kind !== 'fd'}
            placeholder={kind === 'fd' ? 'Optional' : 'SGB 2032 Series IV'}
          />
        </FormField>
      </div>
      {#if kind === 'fd'}
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Amount deposited (₹)">
            <Input inputmode="decimal" bind:value={principal} required />
          </FormField>
          <FormField label="Interest rate (% a year)">
            <Input inputmode="decimal" bind:value={ratePct} required />
          </FormField>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:gap-4">
          <FormField label="Start"><Input type="date" bind:value={start} required /></FormField>
          <FormField label="Maturity"
            ><Input type="date" bind:value={maturity} required /></FormField
          >
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Interest">
            <NativeSelect bind:value={payout} class="w-full">
              <option value="cumulative">Added to the FD (cumulative)</option>
              <option value="monthly">Paid out monthly</option>
              <option value="quarterly">Paid out quarterly</option>
              <option value="half-yearly">Paid out half-yearly</option>
              <option value="yearly">Paid out yearly</option>
            </NativeSelect>
          </FormField>
          {#if payout === 'cumulative'}
            <FormField label="Compounding">
              <NativeSelect bind:value={compounding} class="w-full">
                <option value="quarterly">Quarterly (most banks)</option>
                <option value="monthly">Monthly</option>
                <option value="half-yearly">Half-yearly</option>
                <option value="yearly">Yearly</option>
                <option value="none">Simple interest</option>
              </NativeSelect>
            </FormField>
          {/if}
        </div>
      {:else}
        <FormField label="ISIN (for daily prices)">
          <Input bind:value={isin} placeholder="IN0020230184" />
        </FormField>
        <div class="grid grid-cols-2 gap-3 sm:gap-4">
          <FormField label="Units">
            <Input inputmode="decimal" bind:value={units} required />
          </FormField>
          <FormField label="Price paid per unit (₹)">
            <Input inputmode="decimal" bind:value={price} required />
          </FormField>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:gap-4">
          <FormField label={kind === 'sgb' ? 'Issue date' : 'Bought / issued'}>
            <Input type="date" bind:value={start} required />
          </FormField>
          <FormField label="Maturity"
            ><Input type="date" bind:value={maturity} required /></FormField
          >
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Face value (₹, issue price for SGB)">
            <Input inputmode="decimal" bind:value={faceValue} placeholder="Same as price" />
          </FormField>
          <FormField label="Coupon (% a year)">
            <Input inputmode="decimal" bind:value={couponPct} />
          </FormField>
        </div>
        <FormField label="Coupon paid">
          <NativeSelect bind:value={couponFreq} class="w-full">
            <option value={1}>Yearly</option>
            <option value={2}>Twice a year</option>
            <option value={4}>Quarterly</option>
            <option value={12}>Monthly</option>
          </NativeSelect>
        </FormField>
      {/if}
      <Button type="submit" class="sm:justify-self-start">Save</Button>
    </form>
  </Card.Content>
</Card.Root>
