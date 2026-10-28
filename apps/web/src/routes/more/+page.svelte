<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Calculator from '@lucide/svelte/icons/calculator';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import CreditCard from '@lucide/svelte/icons/credit-card';
  import HandCoins from '@lucide/svelte/icons/hand-coins';
  import IndianRupee from '@lucide/svelte/icons/indian-rupee';
  import LockIcon from '@lucide/svelte/icons/lock';
  import Settings from '@lucide/svelte/icons/settings';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Target from '@lucide/svelte/icons/target';

  import { lock } from '#lib/app.svelte.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';

  const links = [
    {
      href: '#/plan',
      label: 'Plan',
      hint: 'Targets, allocation and your emergency fund',
      icon: Target,
    },
    {
      href: '#/checks',
      label: 'Checks',
      hint: 'Stale balances, mismatches and missing prices',
      icon: ShieldCheck,
    },
    {
      href: '#/loans',
      label: 'Loans',
      hint: 'Money you lent or borrowed',
      icon: HandCoins,
    },
    {
      href: '#/cards',
      label: 'Cards',
      hint: 'Credit card bills and payments',
      icon: CreditCard,
    },
    {
      href: '#/tools',
      label: 'Tools',
      hint: 'Calculators, like bond or FD',
      icon: Calculator,
    },
    {
      href: '#/income',
      label: 'Income per year',
      hint: 'Interest and dividends by financial year',
      icon: IndianRupee,
    },
    {
      href: '#/settings',
      label: 'Settings, backup and export',
      hint: 'Theme, members and accounts, unlocking, prices',
      icon: Settings,
    },
  ];
</script>

<PageHeader title="More" />
<nav aria-label="More" class="grid">
  {#each links as l (l.href)}
    <a
      href={l.href}
      class="hover:bg-muted -mx-2 flex min-h-14 items-center gap-4 rounded-xl border-b px-2 py-2.5 transition-colors last:border-b-0"
    >
      <l.icon class="text-muted-foreground size-5 shrink-0" />
      <span class="min-w-0 flex-1">
        <span class="text-body block font-semibold">{l.label}</span>
        <span class="text-muted-foreground text-small block">{l.hint}</span>
      </span>
      <ChevronRight class="text-muted-foreground size-4 shrink-0" />
    </a>
  {/each}
</nav>
<Button variant="outline" class="mt-4 w-full lg:hidden" onclick={lock}><LockIcon />Lock</Button>
