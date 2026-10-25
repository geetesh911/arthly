<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Cloud from '@lucide/svelte/icons/cloud';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { GoogleGrant } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app, attempt, say } from '#lib/app.svelte.ts';
  import { ask } from '#lib/confirm.svelte.ts';
  import { dateTime } from '#lib/format.ts';
  import { prepareGoogle, signInWithGoogle } from '#lib/google.ts';

  import * as Alert from './ui/alert/index.ts';
  import { Button } from './ui/button/index.ts';
  import * as Card from './ui/card/index.ts';

  let setUp = $state<boolean | null>(null);
  let waiting = $state<AbortController | null>(null);
  let connecting = $state(false);
  const s = $derived(app.sync);
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  onMount(async () => {
    app.sync = await api().cloudStatus();
    setUp = await prepareGoogle();
  });

  // Google's page has to open from the click itself, so nothing is awaited before it.
  function connect() {
    const controller = new AbortController();
    const signIn = signInWithGoogle('connect', controller.signal, app.vault?.vaultId);

    waiting = controller;
    void finish(signIn);
  }

  async function finish(signIn: Promise<GoogleGrant | null>) {
    const grant = await attempt(() => signIn);

    waiting = null;

    if (!grant) {
      return;
    }

    connecting = true;
    const status = await attempt(() => api().connectGoogle(grant));

    connecting = false;

    if (status) {
      app.sync = status;
      say(status.error ?? 'Google Drive is connected.');
    }
  }

  async function syncNow() {
    const status = await attempt(() => api().syncNow());

    if (status) {
      app.sync = status;
    }
  }

  async function disconnect() {
    const ok = await ask({
      title: 'Stop syncing on this device?',
      description:
        'This device keeps its data. The files stay in Google Drive for your other devices; you can delete the Arthly folder there.',
      action: 'Disconnect',
    });

    if (ok && (await attempt(() => api().disconnectCloud()))) {
      app.sync = await api().cloudStatus();
      say('This device no longer syncs.');
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Cloud sync</Card.Title>
    <Card.Description
      >Keep this portfolio up to date on all your devices. Only encrypted files go to your Google
      Drive, in a folder named Arthly.</Card.Description
    >
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if s && !s.available}
      <p class="text-muted-foreground text-sm">
        Sample data stays in this browser and doesn’t sync.
      </p>
    {:else if s?.provider}
      <div
        class="flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm"
        data-testid="sync-status"
      >
        <Cloud class="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="block font-medium break-words"
            >Google Drive{s.account ? ` · ${s.account}` : ''}</span
          >
          <span class="text-muted-foreground block text-xs" aria-live="polite"
            >{s.syncing
              ? 'Syncing…'
              : s.lastSync
                ? `Last synced ${dateTime(s.lastSync)}`
                : 'Not synced yet'}</span
          >
        </span>
      </div>
      {#if s.reconnect}
        <Alert.Root>
          <TriangleAlert />
          <Alert.Description
            >Google Drive needs you to sign in again. Your changes wait on this device until then.</Alert.Description
          >
        </Alert.Root>
      {:else if s.error}
        <Alert.Root variant="destructive">
          <TriangleAlert />
          <Alert.Description>{s.error}</Alert.Description>
        </Alert.Root>
      {:else if s.retrying}
        <p class="text-muted-foreground text-sm">
          The last sync didn’t finish, perhaps because this device is offline. It will try again.
        </p>
      {/if}
      {#if s.problems}
        <p class="text-muted-foreground text-sm">
          {s.problems}
          {plural(s.problems, 'file', 'files')} couldn’t be read and {plural(
            s.problems,
            'was',
            'were',
          )}
          skipped.
        </p>
      {/if}
      <div class="flex flex-wrap gap-2">
        {#if s.reconnect}
          <Button onclick={connect} disabled={!setUp || !!waiting || connecting}
            >{connecting ? 'Connecting…' : 'Sign in again'}</Button
          >
        {:else}
          <Button variant="outline" onclick={syncNow} disabled={s.syncing}
            ><RefreshCw />Sync now</Button
          >
        {/if}
        <Button variant="ghost" class="text-destructive" onclick={disconnect}>Disconnect</Button>
      </div>
    {:else}
      {#if setUp === false}
        <p class="text-muted-foreground text-sm">
          Google Drive isn’t set up for this copy of Arthly. Whoever runs it can add it, as the
          README’s “Cloud sync” section describes.
        </p>
      {/if}
      <Button
        class="justify-self-start"
        onclick={connect}
        disabled={!setUp || !!waiting || connecting}
        ><Cloud />{connecting ? 'Connecting…' : 'Connect Google Drive'}</Button
      >
    {/if}
    {#if waiting}
      <p class="flex flex-wrap items-center gap-x-2 text-sm" role="status">
        Waiting for Google…
        <Button variant="link" size="sm" class="h-auto px-0" onclick={() => waiting?.abort()}
          >Cancel</Button
        >
      </p>
    {/if}
    {#if s?.available !== false}
      <p class="text-muted-foreground text-xs leading-relaxed">
        Each device connects on its own. On a new device, choose <strong
          >Open from Google Drive</strong
        >
        where it asks you to unlock, and use your passphrase or recovery code.
      </p>
    {/if}
  </Card.Content>
</Card.Root>
