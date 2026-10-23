<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- One loan in a list: who, a line about it, and what's owed (or was, once settled). -->
<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { date, inr } from '#lib/format.ts';
  import { LOAN_WORDS } from '#lib/loans.ts';
  import { cn } from '#lib/utils.ts';
  import type { LoanDto } from '#lib/worker/dto.ts';

  let { loan, showMember = false }: { loan: LoanDto; showMember?: boolean } = $props();

  const line = $derived(
    [
      showMember && loan.memberName,
      !loan.open && LOAN_WORDS[loan.direction].section,
      loan.open
        ? loan.due
          ? `Due ${date(loan.due)}`
          : loan.start && `Since ${date(loan.start)}`
        : `${loan.writtenOff > 0 ? 'Written off' : 'Settled'} ${date(loan.settled)}`,
      loan.open && loan.repaid > 0 && `${inr(loan.repaid)} back of ${inr(loan.advanced)}`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<a
  href={`#/loans/${loan.id}`}
  class="hover:bg-muted flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
  data-testid="loan-row"
>
  <span class="min-w-0 flex-1">
    <span class="flex min-w-0 items-center gap-2">
      <span class="truncate text-sm font-medium">{loan.party}</span>
      {#if loan.overdue}<Badge variant="destructive">Overdue</Badge>{/if}
    </span>
    <span class="text-muted-foreground block truncate text-xs">{line}</span>
  </span>
  <span
    class={cn('shrink-0 text-sm font-medium tabular-nums', !loan.open && 'text-muted-foreground')}
    >{inr(loan.open ? loan.balance : loan.advanced)}</span
  >
  <ChevronRight class="text-muted-foreground size-4 shrink-0" />
</a>
