<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Landmark from '@lucide/svelte/icons/landmark';

  import PageHeader from '#lib/components/PageHeader.svelte';
  import * as Card from '#lib/components/ui/card/index.ts';

  const tools = [
    {
      href: '#/tools/bond-vs-fd',
      label: 'Bond or FD',
      hint: 'A bond’s yield to maturity, and how it compares with an FD after tax',
      icon: Landmark,
    },
  ];
</script>

<PageHeader title="Tools" back={{ href: '#/more', label: 'More' }} backClass="lg:hidden" />
<p class="text-muted-foreground text-sm">
  Calculators to help you decide. Nothing here changes your portfolio.
</p>
<Card.Root size="sm">
  <Card.Content class="grid px-2">
    {#each tools as t (t.href)}
      <a
        href={t.href}
        class="hover:bg-muted flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
      >
        <span
          class="bg-secondary text-secondary-foreground grid size-9 place-items-center rounded-full"
        >
          <t.icon class="size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium">{t.label}</span>
          <span class="text-muted-foreground block text-xs">{t.hint}</span>
        </span>
        <ChevronRight class="text-muted-foreground size-4" />
      </a>
    {/each}
  </Card.Content>
</Card.Root>
