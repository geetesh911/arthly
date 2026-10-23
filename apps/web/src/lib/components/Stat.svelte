<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { cn } from '#lib/utils.ts';

  let {
    label,
    value,
    tone,
    hint,
    testid,
  }: {
    label: string;
    value: string;
    tone?: 'gain' | 'loss' | undefined;
    hint?: string | undefined;
    testid?: string | undefined;
  } = $props();
</script>

<div class="flex min-w-0 flex-col gap-0.5">
  <span class="text-muted-foreground text-xs">{label}</span>
  <strong
    class={cn(
      'truncate text-lg font-semibold tabular-nums',
      tone === 'gain' && 'text-gain',
      tone === 'loss' && 'text-loss',
    )}
    data-slot="stat-value"
    data-testid={testid}>{value}</strong
  >
  {#if hint}<span class="text-muted-foreground text-xs">{hint}</span>{/if}
</div>
