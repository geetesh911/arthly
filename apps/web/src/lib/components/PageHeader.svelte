<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';

  import { Button } from '#lib/components/ui/button/index.ts';
  import { cn } from '#lib/utils.ts';

  let {
    title,
    description,
    back,
    backClass,
    actions,
  }: {
    title: string;
    description?: string | undefined;
    back?: { href: string; label: string } | undefined;
    /** Lets a screen hide the back link where the sidebar already leads there. */
    backClass?: string | undefined;
    actions?: Snippet | undefined;
  } = $props();
</script>

<div class="space-y-1">
  {#if back}
    <Button variant="ghost" size="sm" href={back.href} class={cn('-ml-2', backClass)}
      ><ChevronLeft />{back.label}</Button
    >
  {/if}
  <!-- The title keeps its width, so on a phone the actions wrap below it rather than squeeze it. -->
  <div class="flex flex-wrap items-center gap-3">
    <div class="min-w-0 flex-auto">
      <h1 class="text-headline font-semibold">{title}</h1>
      {#if description}<p class="text-muted-foreground text-small">{description}</p>{/if}
    </div>
    {#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
  </div>
</div>
