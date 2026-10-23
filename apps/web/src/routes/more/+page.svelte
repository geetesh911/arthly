<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import IndianRupee from '@lucide/svelte/icons/indian-rupee';
  import Settings from '@lucide/svelte/icons/settings';

  import PageHeader from '#lib/components/PageHeader.svelte';
  import * as Card from '#lib/components/ui/card/index.ts';

  const links = [
    {
      href: '#/analytics',
      label: 'Portfolio analytics',
      hint: 'Allocation, concentration and investment planning',
      icon: ChartNoAxesCombined,
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
<Card.Root size="sm">
  <Card.Content class="grid px-2">
    {#each links as l (l.href)}
      <a
        href={l.href}
        class="hover:bg-muted flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
      >
        <span
          class="bg-secondary text-secondary-foreground grid size-9 place-items-center rounded-full"
        >
          <l.icon class="size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium">{l.label}</span>
          <span class="text-muted-foreground block text-xs">{l.hint}</span>
        </span>
        <ChevronRight class="text-muted-foreground size-4" />
      </a>
    {/each}
  </Card.Content>
</Card.Root>
