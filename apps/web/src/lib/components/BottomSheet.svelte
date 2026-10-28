<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Ink's panel from the bottom, for detail a screen shouldn't spell out: the parts of net worth,
     how figures are counted. On wide screens it's a centred panel. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import XIcon from '@lucide/svelte/icons/x';

  import * as Sheet from '#lib/components/ui/sheet/index.ts';

  let {
    title,
    open = $bindable(false),
    trigger,
    children,
  }: {
    title: string;
    open?: boolean;
    /** The control that opens it; spread `props` on it. */
    trigger: Snippet<[Record<string, unknown>]>;
    children: Snippet;
  } = $props();
</script>

<Sheet.Root bind:open>
  <Sheet.Trigger>
    {#snippet child({ props })}{@render trigger(props)}{/snippet}
  </Sheet.Trigger>
  <Sheet.Content
    side="bottom"
    showCloseButton={false}
    class="mx-auto max-h-[85dvh] max-w-lg gap-2 overflow-y-auto rounded-t-4xl border-none px-4 pt-2 pb-[calc(2rem+env(safe-area-inset-bottom))]"
  >
    <span aria-hidden="true" class="bg-input mx-auto h-1 w-9 shrink-0 rounded-full"></span>
    <div class="flex min-h-11 items-center justify-between">
      <Sheet.Title class="text-title font-semibold">{title}</Sheet.Title>
      <Sheet.Close
        class="text-muted-foreground hover:text-foreground -mr-3 grid size-11 place-items-center rounded-full"
        ><XIcon class="size-5" /><span class="sr-only">Close</span></Sheet.Close
      >
    </div>
    {@render children()}
  </Sheet.Content>
</Sheet.Root>
