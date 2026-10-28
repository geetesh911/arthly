<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Add on phones: a panel from the bottom with a link to each form, grouped by area. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import * as Sheet from '#lib/components/ui/sheet/index.ts';

  import { addGroups } from './Nav.ts';

  let { class: className, children }: { class?: string; children: Snippet } = $props();
  let open = $state(false);
</script>

<Sheet.Root bind:open>
  <Sheet.Trigger class={className}>{@render children()}</Sheet.Trigger>
  <Sheet.Content side="bottom" class="rounded-t-4xl pb-[env(safe-area-inset-bottom)]">
    <Sheet.Header>
      <Sheet.Title class="text-lg font-semibold">Add</Sheet.Title>
    </Sheet.Header>
    <div class="grid gap-4 px-6 pb-6">
      {#each addGroups as group, i (group.label ?? i)}
        <section class="grid gap-2">
          {#if group.label}<h2 class="text-muted-foreground text-xs">{group.label}</h2>{/if}
          <div class="grid grid-cols-2 gap-2">
            {#each group.links as link (link.href)}
              <a
                href={link.href}
                onclick={() => (open = false)}
                class="hover:bg-muted flex min-h-12 items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-medium transition-colors"
              >
                <link.icon class="text-muted-foreground size-5 shrink-0" />
                {link.label}
              </a>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </Sheet.Content>
</Sheet.Root>
