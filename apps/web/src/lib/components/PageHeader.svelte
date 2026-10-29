<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';

  import HideAmounts from '#lib/components/HideAmounts.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { cn } from '#lib/utils.ts';

  let {
    title,
    description,
    back,
    backClass,
    amounts = false,
    actions,
  }: {
    title: string;
    description?: string | undefined;
    back?: { href: string; label: string } | undefined;
    /** Lets a screen hide the back link where the sidebar already leads there. */
    backClass?: string | undefined;
    /** The screen shows amounts, so it offers the eye that hides them. */
    amounts?: boolean;
    actions?: Snippet | undefined;
  } = $props();
</script>

<div class="space-y-1">
  {#if back}
    <Button variant="ghost" size="sm" href={back.href} class={cn('-ml-2', backClass)}
      ><ChevronLeft />{back.label}</Button
    >
  {/if}
  <!-- The title keeps its width, so on a phone the actions wrap below it rather than squeeze it.
       The eye stays beside the title. -->
  <div class="flex items-start gap-1">
    <div class="flex min-w-0 flex-auto flex-wrap items-center gap-3">
      <div class="min-w-0 flex-auto">
        <h1 class="text-headline font-semibold">{title}</h1>
        {#if description}<p class="text-muted-foreground text-small">{description}</p>{/if}
      </div>
      {#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
    </div>
    {#if amounts}<HideAmounts class="-mr-2" />{/if}
  </div>
</div>
