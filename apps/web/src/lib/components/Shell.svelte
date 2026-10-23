<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { on } from 'svelte/events';
  import { page } from '$app/state';
  import LockIcon from '@lucide/svelte/icons/lock';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  import { app, lock } from '#lib/app.svelte.ts';
  import * as Alert from '#lib/components/ui/alert/index.ts';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { cn } from '#lib/utils.ts';

  import { sections } from './Nav.ts';

  let { children }: { children: Snippet } = $props();
  let waiting = $state<ServiceWorker | null>(null);

  $effect(() => {
    const sw = navigator.serviceWorker;

    if (!sw) {
      return;
    }

    // A new version otherwise waits until every tab of the app is closed; reloading isn't enough.
    // Once it takes over, pages still on the old version reload, since their files are gone.
    const off = on(sw, 'controllerchange', () => location.reload());

    void sw.getRegistration().then((reg) => {
      if (!reg) {
        return;
      }

      const check = () => (waiting = reg.waiting);

      // The browser looks for a new version when the page opens, often before unlocking.
      const follow = () => {
        if (reg.installing) {
          on(reg.installing, 'statechange', check);
        }
      };

      check();
      follow();
      on(reg, 'updatefound', follow);
    });

    return off;
  });

  const route = $derived(page.route.id ?? '/');
</script>

{#snippet member(size: 'sm' | 'default', className: string)}
  {#if app.members.length > 1}
    <NativeSelect aria-label="Member" bind:value={app.filter.memberId} {size} class={className}>
      <option value={undefined}>Everyone</option>
      {#each app.members as m (m.id)}
        <option value={m.id}>{m.name}</option>
      {/each}
    </NativeSelect>
  {/if}
{/snippet}

<div class="min-h-dvh lg:pl-64">
  <aside
    class="bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-20 hidden w-64 flex-col gap-6 border-r p-4 lg:flex"
  >
    <div class="flex items-center gap-3 px-2 pt-2">
      <span
        class="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-2xl"
      >
        <ShieldCheck class="size-5" />
      </span>
      <div class="min-w-0">
        <p class="truncate font-semibold">{app.vault?.name}</p>
        {#if app.vault?.demo}<Badge variant="secondary">Sample data</Badge>{/if}
      </div>
    </div>
    <nav aria-label="Sections" class="flex flex-col gap-1">
      {#each sections.filter((s) => s.desktop) as s (s.href)}
        {@const active = s.match(route)}
        <a
          href={s.href}
          aria-current={active ? 'page' : undefined}
          class={cn(
            'flex h-10 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors',
            active
              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          )}
        >
          <s.icon class="size-4" />
          {s.label}
        </a>
      {/each}
    </nav>
    <div class="mt-auto flex flex-col gap-2">
      {@render member('default', 'w-full')}
      <Button variant="outline" onclick={lock}><LockIcon />Lock</Button>
    </div>
  </aside>

  <header
    class="bg-background/85 sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden"
  >
    <div class="flex h-14 items-center gap-2 px-4">
      <p class="min-w-0 flex-1 truncate font-semibold">{app.vault?.name}</p>
      {#if app.vault?.demo}<Badge variant="secondary" class="hidden sm:inline-flex"
          >Sample data</Badge
        >{/if}
      {@render member('sm', 'max-w-[40%]')}
      <Button variant="ghost" size="icon" aria-label="Lock" onclick={lock}><LockIcon /></Button>
    </div>
  </header>

  <main class="mx-auto max-w-6xl space-y-4 px-4 pt-4 pb-28 lg:px-8 lg:pt-8 lg:pb-12">
    {#if app.vault?.readOnly}
      <Alert.Root variant="destructive">
        <TriangleAlert />
        <Alert.Title>This portfolio was changed by a newer version of the app.</Alert.Title>
        <Alert.Description>Update the app to make changes.</Alert.Description>
      </Alert.Root>
    {/if}
    {#if waiting}
      <Alert.Root>
        <RefreshCw />
        <Alert.Title>A new version is ready.</Alert.Title>
        <Alert.Description class="grid gap-3">
          <p>Update now, or it applies the next time you open the app. Updating locks the app.</p>
          <Button
            variant="outline"
            size="sm"
            class="justify-self-start"
            onclick={() => waiting?.postMessage('skip-waiting')}>Update now</Button
          >
        </Alert.Description>
      </Alert.Root>
    {/if}
    {@render children()}
  </main>

  <nav
    aria-label="Screens"
    class="bg-background/90 fixed inset-x-0 bottom-0 z-20 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
  >
    {#each sections.filter((s) => s.phone) as s (s.href)}
      {@const active = s.match(route)}
      <a
        href={s.href}
        aria-current={active ? 'page' : undefined}
        class={cn(
          'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors',
          active ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}
      >
        <span
          class={cn(
            'grid h-7 w-12 place-items-center rounded-full transition-colors',
            active && 'bg-primary text-primary-foreground',
          )}><s.icon class="size-5" /></span
        >
        {s.label}
      </a>
    {/each}
  </nav>
</div>
