<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import {
    type BondFdInput,
    bondFdProblem,
    bondProblem,
    type BondTax,
    bondYields,
    compareBondFd,
    type CouponFrequency,
    type Payout,
  } from '@pv/core';

  import { pct, typed } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';

  import * as Card from './ui/card/index.ts';
  import { Checkbox } from './ui/checkbox/index.ts';
  import { Input } from './ui/input/index.ts';
  import { NativeSelect } from './ui/native-select/index.ts';
  import * as Table from './ui/table/index.ts';
  import FormField from './FormField.svelte';
  import Stat from './Stat.svelte';

  const SEBI = 'https://investor.sebi.gov.in/calc/bond.html';

  let price = $state<number | null>(1000);
  let par = $state<number | null>(1000);
  let couponPct = $state<number | null>(8.5);
  let years = $state<number | null>(3);
  let frequency = $state<CouponFrequency>('yearly');
  let daysSinceCoupon = $state<number | null>(null);
  let fdRate = $state<number | null>(7);
  let fdPayout = $state<Payout>('cumulative');
  let amount = $state<number | null>(100_000);
  let taxPct = $state<number | null>(31.2);
  let bondTax = $state<BondTax>('section-57');
  let listed = $state(true);

  // An empty field is NaN, so it's caught as missing rather than taken as 0.
  const num = (n: number | null) => n ?? Number.NaN;
  const input = $derived<BondFdInput>({
    amount: num(amount),
    taxPct: num(taxPct),
    bondTax,
    listed,
    bond: {
      price: num(price),
      par: num(par),
      couponPct: num(couponPct),
      years: num(years),
      frequency,
      // Left empty, it's worked out from the years to maturity.
      daysSinceCoupon: daysSinceCoupon ?? null,
    },
    fd: { ratePct: num(fdRate), payout: fdPayout },
  });
  const bondIssue = $derived(bondProblem(input.bond));
  const yields = $derived(bondIssue ? null : bondYields(input.bond));
  const problem = $derived(bondFdProblem(input));
  const result = $derived(problem ? null : compareBondFd(input));
  const gap = $derived(
    result?.fd.yieldAfterTax != null && result.bond.yieldAfterTax != null
      ? result.bond.yieldAfterTax - result.fd.yieldAfterTax
      : null,
  );
  // Under half a basis point apart is the same, as returns show to 2 decimals.
  const better = $derived(gap === null || Math.abs(gap) < 0.00005 ? null : gap > 0 ? 'bond' : 'fd');
  const verdict = $derived(
    gap === null
      ? ''
      : better
        ? `The ${better === 'bond' ? 'bond' : 'FD'} returns ${pct(Math.abs(gap))} a year more after tax.`
        : 'Both return the same after tax.',
  );
  const fdWay = $derived(
    fdPayout === 'cumulative' ? 'with interest added to it' : `paying interest ${fdPayout}`,
  );
  const yearsFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const daysFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
  const accruedHint = $derived(
    yields?.daysSinceCoupon
      ? `${daysFmt.format(yields.daysSinceCoupon)} ${yields.daysSinceCoupon === 1 ? 'day' : 'days'} since the last coupon`
      : 'None on a coupon date',
  );
  const TAX_HINTS: Record<BondTax, string> = {
    'section-57':
      'Coupons are taxed in full. The accrued interest and any premium you paid are claimed back under Section 57, and a discount from the seller is taxed as interest.',
    'capital-gains':
      'Coupons are taxed in full. Accrued interest becomes part of the bond’s cost, and par above that cost is a capital gain at maturity.',
  };
  const rows = $derived(
    result
      ? ([
          ['You get back', typed.inr(result.bond.received), typed.inr(result.fd.received)],
          ['Gain', typed.inr(result.bond.gain), typed.inr(result.fd.gain)],
          ['Tax', typed.inr(result.bond.tax), typed.inr(result.fd.tax)],
          [
            'Gain after tax',
            typed.inr(result.bond.gain - result.bond.tax),
            typed.inr(result.fd.gain - result.fd.tax),
          ],
          ['Yearly return', pct(result.bond.yield), pct(result.fd.yield)],
        ] as const)
      : [],
  );
</script>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-lg font-semibold">Bond</Card.Title>
      <Card.Description
        >Yields worked out as in <a
          href={SEBI}
          target="_blank"
          rel="noopener noreferrer"
          class="text-foreground underline underline-offset-4">SEBI’s bond yield calculator</a
        >, plus the accrued interest you pay between coupons.</Card.Description
      >
    </Card.Header>
    <Card.Content class="grid gap-4">
      <div class="grid grid-cols-2 gap-3">
        <FormField label="Current price (₹)" hint="As quoted, without accrued interest.">
          <Input type="number" min="0" step="0.01" bind:value={price} />
        </FormField>
        <FormField label="Par value (₹)">
          <Input type="number" min="0" step="1" bind:value={par} />
        </FormField>
        <FormField label="Coupon rate (%)">
          <Input type="number" min="0" max="100" step="0.05" bind:value={couponPct} />
        </FormField>
        <FormField label="Years to maturity" hint="Days to maturity divided by 365.">
          <Input type="number" min="0" step="0.5" bind:value={years} />
        </FormField>
        <FormField label="Coupons">
          <NativeSelect bind:value={frequency} class="w-full">
            <option value="yearly">Paid yearly</option>
            <option value="half-yearly">Paid half-yearly</option>
            <option value="quarterly">Paid quarterly</option>
            <option value="monthly">Paid monthly</option>
          </NativeSelect>
        </FormField>
        <FormField
          label="Days accrued"
          hint="Since the last coupon. Leave empty if coupons fall in step with maturity."
        >
          <Input
            type="number"
            min="0"
            step="1"
            placeholder={yields ? daysFmt.format(yields.daysSinceCoupon) : ''}
            bind:value={daysSinceCoupon}
          />
        </FormField>
      </div>
      {#if yields}
        <div class="grid grid-cols-2 gap-x-3 gap-y-4 border-t pt-4">
          <Stat
            label="Accrued interest"
            value={typed.inrExact(yields.accrued)}
            hint={accruedHint}
            testid="accrued"
          />
          <Stat
            label="Total price"
            value={typed.inrExact(yields.totalPrice)}
            hint="What one bond costs to buy"
            testid="total-price"
          />
          <Stat label="Current yield" value={pct(yields.currentYield)} testid="current-yield" />
          <Stat
            label="Yield to maturity (SEBI)"
            value={pct(yields.ytm)}
            hint={frequency === 'yearly' ? undefined : 'Counts one coupon a year, as SEBI does'}
            testid="ytm"
          />
          <div class="col-span-2">
            <Stat
              label="Yield on what you pay"
              value={pct(yields.yieldOnPaid)}
              hint="On the total price, with each coupon on its date. The comparison uses this."
              testid="yield-on-paid"
            />
          </div>
        </div>
      {:else}
        <p class="text-muted-foreground border-t pt-4 text-sm">{bondIssue}</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="text-lg font-semibold">Fixed deposit</Card.Title>
      <Card.Description
        >The same money for the same {yields
          ? `${yearsFmt.format(years!)} years`
          : 'term'}.</Card.Description
      >
    </Card.Header>
    <Card.Content class="grid content-start gap-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <FormField label="Interest rate (%)">
          <Input type="number" min="0" max="100" step="0.05" bind:value={fdRate} />
        </FormField>
        <FormField label="Interest">
          <NativeSelect bind:value={fdPayout} class="w-full">
            <option value="cumulative">Added to the FD</option>
            <option value="monthly">Paid out monthly</option>
            <option value="quarterly">Paid out quarterly</option>
            <option value="half-yearly">Paid out half-yearly</option>
            <option value="yearly">Paid out yearly</option>
          </NativeSelect>
        </FormField>
      </div>
      <div class="border-t pt-4">
        <Stat
          label="Yearly return"
          value={pct(result?.fd.yield)}
          hint="Interest added to the FD compounds quarterly, as at most banks."
          testid="fd-yield"
        />
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root class="lg:col-span-2">
    <Card.Header>
      <Card.Title class="text-lg font-semibold">Compare</Card.Title>
      <Card.Description>What each pays back, before and after tax.</Card.Description>
    </Card.Header>
    <Card.Content class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div class="grid content-start gap-4">
        <div class="grid grid-cols-2 gap-3">
          <FormField label="Amount (₹)">
            <Input type="number" min="0" step="1000" bind:value={amount} />
          </FormField>
          <FormField label="Tax on interest (%)">
            <Input type="number" min="0" max="100" step="0.1" bind:value={taxPct} />
          </FormField>
        </div>
        <p class="text-muted-foreground text-xs">
          Tax is your slab plus cess: 31.2 for 30%. Enter 0 to compare before tax.
        </p>
        <FormField label="Tax on the bond" hint={TAX_HINTS[bondTax]}>
          <NativeSelect bind:value={bondTax} class="w-full">
            <option value="section-57">Wint’s way: all at your slab</option>
            <option value="capital-gains">Capital gains on the price</option>
          </NativeSelect>
        </FormField>
        {#if bondTax === 'capital-gains'}
          <label class="flex items-center gap-2 text-sm">
            <Checkbox bind:checked={listed} />Listed on a stock exchange
          </label>
        {/if}
        {#if result}
          <p class="text-sm" data-testid="bond-units">
            Buys {result.units}
            {result.units === 1 ? 'bond' : 'bonds'} for {typed.inr(
              result.bond.invested,
            )}{result.accrued
              ? `, including ${typed.inr(result.accrued)} of accrued interest,`
              : ''} and the FD gets the same.
          </p>
        {/if}
      </div>

      <div class="grid content-start gap-4" aria-live="polite">
        {#if problem}
          <p class="text-muted-foreground text-sm">{problem}</p>
        {:else if result}
          <p class="text-lg font-semibold" data-testid="bond-fd-verdict">{verdict}</p>
          <Table.Root class="table-fixed">
            <Table.Header>
              <Table.Row>
                <Table.Head class="w-[40%]"><span class="sr-only">Measure</span></Table.Head>
                <Table.Head class="text-right whitespace-normal">Bond</Table.Head>
                <Table.Head class="text-right whitespace-normal">Fixed deposit</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each rows as [label, bond, fd] (label)}
                <Table.Row>
                  <Table.Cell class="text-muted-foreground whitespace-normal">{label}</Table.Cell>
                  <Table.Cell class="text-right tabular-nums">{bond}</Table.Cell>
                  <Table.Cell class="text-right tabular-nums">{fd}</Table.Cell>
                </Table.Row>
              {/each}
              <Table.Row class="font-semibold">
                <Table.Cell class="whitespace-normal">Yearly return after tax</Table.Cell>
                <Table.Cell
                  class={cn('text-right tabular-nums', better === 'bond' && 'text-gain')}
                  data-testid="bond-after-tax">{pct(result.bond.yieldAfterTax)}</Table.Cell
                >
                <Table.Cell
                  class={cn('text-right tabular-nums', better === 'fd' && 'text-gain')}
                  data-testid="fd-after-tax">{pct(result.fd.yieldAfterTax)}</Table.Cell
                >
              </Table.Row>
            </Table.Body>
          </Table.Root>
          {#if result.matchingFdRatePct !== null}
            <p class="text-sm" data-testid="fd-match">
              An FD {fdWay} would need {result.matchingFdRatePct.toFixed(2)}% a year to match this
              bond after tax.
            </p>
          {/if}
        {/if}
      </div>

      <div class="text-muted-foreground grid gap-2 text-xs leading-relaxed xl:col-span-2">
        <p>
          SEBI’s yield to maturity follows its calculator: one coupon a year on the par value,
          worked out on the price without accrued interest, however often the bond pays. Buying
          between coupons, you pay the seller the coupon rate on par for each day since the last
          one, over 365 days, and get it back in the next coupon, paid in full. Left empty, the days
          since the last coupon are worked out with coupons in step with maturity; otherwise the
          last coupon is paid pro rata with par. The yield on what you pay counts every coupon on
          its date and the accrued interest, as bond platforms like Wint Wealth show it, and the
          comparison uses it. Fees are left out. The FD’s yearly return is the same kind of rate, so
          interest paid out sooner counts for more than the same interest at maturity. Interest
          added to an FD is taxed each year as it’s earned.
        </p>
        <p>
          Wint’s way follows Wint Wealth’s tax guide. Some CAs treat accrued interest and premiums
          as part of the cost instead, as the capital gains way does, so check with yours. In the
          capital gains way, a gain is taxed at 12.5% plus cess at most on a listed bond held over a
          year and at your slab otherwise, and a loss isn’t counted as saving tax. A higher yield
          usually means more risk, so check the bond’s credit rating; bank FDs are insured up to ₹5
          lakh per depositor per bank by DICGC.
        </p>
      </div>
    </Card.Content>
  </Card.Root>
</div>
