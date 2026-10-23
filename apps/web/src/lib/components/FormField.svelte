<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- A label wrapping its control, with an optional hint below. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '#lib/utils.ts';

  let {
    label,
    hint,
    class: className,
    children,
  }: { label: string; hint?: string | undefined; class?: string; children: Snippet } = $props();
</script>

<div class={cn('grid content-start gap-2', className)}>
  <label class="grid gap-2">
    <span class="text-sm leading-snug font-medium">{label}</span>
    {@render children()}
  </label>
  {#if hint}<p class="text-muted-foreground text-xs">{hint}</p>{/if}
</div>
