<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { on } from 'svelte/events';
  import { page } from '$app/state';
  import LockIcon from '@lucide/svelte/icons/lock';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  import { app, lock } from '#lib/app.svelte.ts';
  import AddMenu from '#lib/components/AddMenu.svelte';
  import AddSheet from '#lib/components/AddSheet.svelte';
  import Logo from '#lib/components/Logo.svelte';
  import * as Alert from '#lib/components/ui/alert/index.ts';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { cn } from '#lib/utils.ts';

  import { addGroups, sections } from './Nav.ts';

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
  const tabs = sections.filter((s) => s.phone);
</script>

{#snippet member(className: string)}
  {#if app.members.length > 1}
    <!-- A pill on phones, like the chips on Holdings; a plain field in the sidebar. -->
    <NativeSelect aria-label="Member" bind:value={app.filter.memberId} class={className}>
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
      <Logo tile class="size-9" />
      <div class="min-w-0">
        <p class="text-title truncate font-semibold">{app.vault?.name}</p>
        {#if app.vault?.demo}<p class="text-muted-foreground text-small">Sample data</p>{/if}
      </div>
    </div>
    <AddMenu groups={addGroups} class="w-full justify-start" />
    <nav aria-label="Sections" class="flex flex-col gap-0.5">
      {#each sections.filter((s) => s.desktop) as s (s.href)}
        {@const active = s.match(route)}
        <a
          href={s.href}
          aria-current={active ? 'page' : undefined}
          class={cn(
            'flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
              : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          )}
        >
          <s.icon class="size-4" />
          {s.label}
        </a>
      {/each}
    </nav>
    <div class="mt-auto flex flex-col gap-2">
      {@render member('w-full')}
      <Button variant="outline" onclick={lock}><LockIcon />Lock</Button>
    </div>
  </aside>

  <header
    class="bg-background/85 sticky top-0 z-20 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden"
  >
    <div class="flex h-14 items-center gap-3 px-4">
      <Logo tile class="size-8" />
      <p class="text-title min-w-0 flex-1 truncate font-semibold">{app.vault?.name}</p>
      {@render member(
        'max-w-[40%] [&_select]:border-border [&_select]:text-body [&_select]:bg-transparent [&_select]:pl-3.5',
      )}
      <!-- Lock is on More, so the header keeps room for the portfolio's name. -->
      <AddSheet class={buttonVariants({ size: 'icon' })}
        ><Plus class="size-5" /><span class="sr-only">Add</span></AddSheet
      >
    </div>
  </header>

  <main class="mx-auto max-w-6xl space-y-4 px-4 pt-2 pb-28 lg:px-8 lg:pt-8 lg:pb-12">
    {#if app.vault?.readOnly}
      <Alert.Root variant="destructive">
        <TriangleAlert />
        <Alert.Title>This portfolio was changed by a newer version of the app.</Alert.Title>
        <Alert.Description>Update the app to make changes.</Alert.Description>
      </Alert.Root>
    {/if}
    {#if waiting}
      <div class="bg-muted flex items-center gap-3 rounded-2xl py-2 pr-2 pl-4" role="status">
        <RefreshCw class="text-muted-foreground size-4 shrink-0" />
        <p class="text-small min-w-0 flex-1">New version ready. Updating locks the app.</p>
        <Button size="sm" onclick={() => waiting?.postMessage('skip-waiting')}>Update</Button>
      </div>
    {/if}
    {@render children()}
  </main>

  <nav
    aria-label="Screens"
    class="bg-background fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
  >
    {#each tabs as s (s.href)}
      {@const active = s.match(route)}
      <a
        href={s.href}
        aria-current={active ? 'page' : undefined}
        class={cn(
          'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
          active ? 'text-foreground font-semibold' : 'text-muted-foreground',
        )}
      >
        <s.icon class="size-[22px]" strokeWidth={1.75} />
        {s.label}
      </a>
    {/each}
  </nav>
</div>
