<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Info from '@lucide/svelte/icons/info';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { Check } from '@pv/core';
  import { api } from '#lib/api.ts';
  import { attempt, changed } from '#lib/app.svelte.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { cn } from '#lib/utils.ts';

  let { checks, limit }: { checks: Check[]; limit?: number } = $props();
  const shown = $derived(limit ? checks.slice(0, limit) : checks);

  const fixLink: Record<string, string> = {
    'record-sell': '#/add/transaction',
    'record-maturity': '#/add/transaction',
    'import-file': '#/add',
    'add-price': '#/add/price',
    backup: '#/settings',
  };

  async function dismiss(key: string) {
    await attempt(() => api().dismiss(key));
    await changed();
  }

  async function restore(ref: string) {
    await attempt(() => api().restoreConflict(ref));
    await changed();
  }
</script>

{#if shown.length === 0}
  <p class="text-muted-foreground flex items-center gap-2 text-sm">
    <CircleCheck class="text-gain size-4" />Everything checks out.
  </p>
{:else}
  <ul class="grid grid-cols-1 gap-3">
    {#each shown as c (c.key)}
      {@const Icon = c.severity === 'warn' ? TriangleAlert : Info}
      <li class="bg-muted/50 flex gap-3 rounded-2xl p-3">
        <Icon
          class={cn(
            'mt-0.5 size-4 shrink-0',
            c.severity === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
          )}
        />
        <div class="grid min-w-0 flex-1 gap-2">
          <p class="text-sm">{c.message}</p>
          <div class="flex flex-wrap gap-2">
            {#if c.fix?.kind === 'resolve-conflict' && c.fix.ref}
              <Button size="sm" variant="outline" onclick={() => restore(c.fix!.ref!)}
                >Restore the other version</Button
              >
            {:else if c.fix && fixLink[c.fix.kind]}
              <Button
                size="sm"
                variant="outline"
                href={`${fixLink[c.fix.kind]}${c.fix.ref ? `?ref=${encodeURIComponent(c.fix.ref)}` : ''}`}
                >Fix</Button
              >
            {/if}
            <Button size="sm" variant="ghost" onclick={() => dismiss(c.key)}>Not a problem</Button>
          </div>
        </div>
      </li>
    {/each}
  </ul>
  {#if limit && checks.length > limit}
    <Button variant="link" size="sm" href="#/checks" class="mt-2 px-0"
      >See all {checks.length}</Button
    >
  {/if}
{/if}
