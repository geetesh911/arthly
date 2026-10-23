<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- One card in a list: its name, a line about its latest bill, and what's left to pay. -->
<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { BILL_STATE_LABELS } from '@pv/core';

  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { inr, shortDate } from '#lib/format.ts';
  import { cn } from '#lib/utils.ts';
  import type { CardDto } from '#lib/worker/dto.ts';

  let { card, showMember = false }: { card: CardDto; showMember?: boolean } = $props();

  const line = $derived(
    [
      card.bank,
      showMember && card.memberName,
      card.closed
        ? `Closed ${shortDate(card.closed)}`
        : !card.bill
          ? 'No bill yet'
          : [
              !card.overdue && card.due > 0 && `Due ${shortDate(card.bill.dueDate)}`,
              BILL_STATE_LABELS[card.bill.state],
              card.credit > 0 && `${inr(card.credit)} in credit`,
            ]
              .filter(Boolean)
              .join(' · '),
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<a
  href={`#/cards/${card.id}`}
  class="hover:bg-muted flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
  data-testid="card-row"
>
  <span class="min-w-0 flex-1">
    <span class="flex min-w-0 items-center gap-2">
      <span class="truncate text-sm font-medium">{card.name}</span>
      {#if card.overdue}<Badge variant="destructive">Overdue</Badge>{/if}
    </span>
    <span class="text-muted-foreground block truncate text-xs">{line}</span>
  </span>
  <span
    class={cn(
      'shrink-0 text-sm font-medium tabular-nums',
      card.due === 0 && 'text-muted-foreground',
    )}>{inr(card.due)}</span
  >
  <ChevronRight class="text-muted-foreground size-4 shrink-0" />
</a>
