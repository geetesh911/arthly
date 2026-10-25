<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { GoogleGrant } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { attempt, opened } from '#lib/app.svelte.ts';
  import { date } from '#lib/format.ts';
  import { prepareGoogle, signInWithGoogle } from '#lib/google.ts';
  import { typedSecret } from '#lib/secret.ts';
  import type { CloudVaultDto } from '#lib/worker/dto.ts';

  import { Button } from './ui/button/index.ts';
  import * as Card from './ui/card/index.ts';
  import { Input } from './ui/input/index.ts';
  import { NativeSelect } from './ui/native-select/index.ts';
  import FormField from './FormField.svelte';

  let {
    grant = null,
    onBack,
  }: {
    /** A sign-in that came back after a full-page redirect. */
    grant?: GoogleGrant | null;
    onBack: () => void;
  } = $props();
  let setUp = $state<boolean | null>(null);
  let waiting = $state<AbortController | null>(null);
  let found = $state<CloudVaultDto[] | null>(null);
  let chosen = $state('');
  let name = $state('My portfolio');
  let secret = $state('');
  let busy = $state(false);
  const vault = $derived(found?.find((v) => v.vaultId === chosen));

  onMount(async () => {
    setUp = await prepareGoogle();

    if (grant) {
      await look(grant);
    }
  });

  // Google's page has to open from the click itself, so nothing is awaited before it.
  function signIn() {
    const controller = new AbortController();
    const pending = signInWithGoogle('open', controller.signal);

    waiting = controller;

    void (async () => {
      const g = await attempt(() => pending);

      waiting = null;

      if (g) {
        await look(g);
      }
    })();
  }

  async function look(g: GoogleGrant) {
    busy = true;
    const list = await attempt(() => api().googlePortfolios(g));

    busy = false;

    if (list) {
      found = list;
      chosen = (list.find((v) => !v.onDevice) ?? list[0])?.vaultId ?? '';
    }
  }

  async function open(event: Event) {
    event.preventDefault();
    busy = true;
    const done = await attempt(() =>
      api().openFromCloud(chosen, typedSecret(secret), name.trim() || 'My portfolio'),
    );

    busy = false;

    if (done) {
      secret = '';
      await opened();
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Open from Google Drive</Card.Title>
    <Card.Description>
      {found?.length
        ? 'Unlock it with its passphrase or recovery code.'
        : 'Sign in to the Google account the portfolio syncs to.'}
    </Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if !found}
      {#if setUp === false}
        <p class="text-muted-foreground text-sm">
          Google Drive isn’t set up for this copy of Arthly.
        </p>
      {/if}
      <div class="flex gap-2">
        <Button class="flex-1" onclick={signIn} disabled={!setUp || !!waiting || busy}
          >{busy ? 'Looking…' : 'Sign in with Google'}</Button
        >
        <Button variant="ghost" onclick={onBack}>Back</Button>
      </div>
      {#if waiting}
        <p class="flex flex-wrap items-center gap-x-2 text-sm" role="status">
          Waiting for Google…
          <Button variant="link" size="sm" class="h-auto px-0" onclick={() => waiting?.abort()}
            >Cancel</Button
          >
        </p>
      {/if}
    {:else if found.length === 0}
      <p class="text-sm">
        There’s no Arthly portfolio in this Google Drive yet. On the device that has it, connect it
        in Settings → Cloud sync.
      </p>
      <Button variant="ghost" class="justify-self-start" onclick={onBack}>Back</Button>
    {:else}
      <form class="grid gap-4" onsubmit={open}>
        {#if found.length > 1}
          <FormField label="Portfolio">
            <NativeSelect bind:value={chosen} class="w-full">
              {#each found as v (v.vaultId)}<option value={v.vaultId}
                  >Made on {date(v.created)}{v.onDevice ? ' · on this device' : ''}</option
                >{/each}
            </NativeSelect>
          </FormField>
        {/if}
        {#if vault?.onDevice}
          <p class="text-sm">This portfolio is already on this device. Go back and unlock it.</p>
        {:else}
          <FormField label="Name on this device">
            <Input bind:value={name} />
          </FormField>
          <FormField label="Passphrase or recovery code">
            <Input type="password" bind:value={secret} autocomplete="current-password" />
          </FormField>
        {/if}
        <div class="flex gap-2">
          <Button
            type="submit"
            class="flex-1"
            disabled={busy || !secret || !vault || vault.onDevice}
            >{busy ? 'Opening…' : 'Open'}</Button
          >
          <Button variant="ghost" onclick={onBack}>Back</Button>
        </div>
      </form>
    {/if}
  </Card.Content>
</Card.Root>
