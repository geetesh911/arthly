<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import '../app.css';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { onMount, type Snippet } from 'svelte';
  import { app, start } from '#lib/app.svelte.ts';
  import Confirm from '#lib/components/Confirm.svelte';
  import Shell from '#lib/components/Shell.svelte';
  import Unlock from '#lib/components/Unlock.svelte';
  import { applyTheme, readTheme } from '#lib/theme.ts';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    applyTheme(document.documentElement, readTheme());
    void start();
    if ('serviceWorker' in navigator) void navigator.storage?.persist?.();
  });
</script>

{#if app.status === 'loading'}
  <div class="text-muted-foreground grid min-h-dvh place-items-center">
    <p class="flex items-center gap-2 text-sm">
      <LoaderCircle class="size-4 animate-spin" />Loading…
    </p>
  </div>
{:else if app.status === 'locked'}
  <Unlock />
{:else}
  <Shell>{@render children()}</Shell>
{/if}

<Confirm />

{#if app.message}
  <div
    role="status"
    class="bg-foreground text-background fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-2xl px-4 py-3 text-sm shadow-lg lg:right-6 lg:bottom-6 lg:left-auto lg:mx-0"
  >
    {app.message}
  </div>
{/if}
