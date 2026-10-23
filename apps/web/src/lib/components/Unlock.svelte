<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import FingerprintPattern from '@lucide/svelte/icons/fingerprint-pattern';
  import Plus from '@lucide/svelte/icons/plus';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Upload from '@lucide/svelte/icons/upload';
  import { onMount } from 'svelte';
  import { api } from '#lib/api.ts';
  import { attempt, opened } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import * as Alert from '#lib/components/ui/alert/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { readFile } from '#lib/files.ts';
  import { passkeysSupported, usePasskey } from '#lib/passkey.ts';
  import type { VaultSummary } from '#lib/worker/dto.ts';
  import Create from './Create.svelte';

  let vaults = $state<VaultSummary[] | null>(null);
  let chosen = $state('');
  let mode = $state<'passphrase' | 'recovery' | 'restore' | 'create'>('passphrase');
  let secret = $state('');
  let busy = $state(false);
  let canPasskey = $state(false);
  let backup = $state<File | null>(null);
  let restoreName = $state('My portfolio');

  const vault = $derived(vaults?.find((v) => v.vaultId === chosen));
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !matchMedia('(display-mode: standalone)').matches;

  onMount(async () => {
    vaults = await api().vaults();
    chosen = vaults.at(-1)?.vaultId ?? '';
    if (vaults.length === 0) mode = 'create';
    canPasskey = await passkeysSupported();
    if (canPasskey && vault?.passkeys.length) void fingerprint();
  });

  async function unlock(event: Event) {
    event.preventDefault();
    busy = true;
    const done = await attempt(() =>
      api().unlock(chosen, mode === 'recovery' ? { recoveryCode: secret } : { passphrase: secret }),
    );
    busy = false;
    if (done) {
      secret = '';
      await opened();
    }
  }

  async function fingerprint() {
    if (!vault) return;
    const result = await attempt(async () => {
      const key = await usePasskey(vault.passkeys);
      await api().unlock(chosen, key);
      return true;
    });
    if (result) await opened();
  }

  async function restore(event: Event) {
    event.preventDefault();
    if (!backup) return;
    busy = true;
    const bytes = await readFile(backup);
    const isCode = /^[A-Za-z2-7]{4}(-?[A-Za-z2-7]{4}){7}$/.test(secret.trim());
    const done = await attempt(() =>
      api().restore(bytes, isCode ? { recoveryCode: secret } : { passphrase: secret }, restoreName),
    );
    busy = false;
    if (done) await opened();
  }

  async function sample() {
    await attempt(() => api().demo());
    await opened();
  }
</script>

{#snippet others(items: ('create' | 'restore' | 'sample')[])}
  <div class="grid gap-1">
    {#each items as item (item)}
      {#if item === 'create'}
        <Button variant="ghost" class="justify-start" onclick={() => (mode = 'create')}
          ><Plus />New portfolio</Button
        >
      {:else if item === 'restore'}
        <Button variant="ghost" class="justify-start" onclick={() => (mode = 'restore')}
          ><Upload />Restore a backup file</Button
        >
      {:else}
        <Button variant="ghost" class="justify-start" onclick={sample}
          ><Sparkles />Try with sample data</Button
        >
      {/if}
    {/each}
  </div>
{/snippet}

<div class="grid min-h-dvh place-items-center px-4 py-10">
  <div class="w-full max-w-sm space-y-6">
    <div class="flex flex-col items-center gap-3 text-center">
      <span
        class="bg-primary text-primary-foreground grid size-12 place-items-center rounded-3xl shadow-md"
      >
        <ShieldCheck class="size-6" />
      </span>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Arthly</h1>
        <p class="text-muted-foreground text-sm">
          Private by design: your data is encrypted on this device.
        </p>
      </div>
    </div>

    {#if ios}
      <Alert.Root>
        <Smartphone />
        <Alert.Title>Add it to your Home Screen</Alert.Title>
        <Alert.Description>
          On iPhone, tap Share → Add to Home Screen and open the app from there. Safari may clear
          data for websites that aren't added.
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if vaults === null}
      <p class="text-muted-foreground text-center text-sm">Loading…</p>
    {:else if mode === 'create'}
      <Create onCancel={vaults.length ? () => (mode = 'passphrase') : undefined} />
      {@render others(['sample', 'restore'])}
    {:else if mode === 'restore'}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg font-semibold">Restore a backup</Card.Title>
          <Card.Description>
            A .pvault file opens with its passphrase or recovery code.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <form class="grid gap-4" onsubmit={restore}>
            <FormField label="Backup file (.pvault)">
              <Input
                type="file"
                accept=".pvault,application/octet-stream"
                onchange={(e) => (backup = e.currentTarget.files?.[0] ?? null)}
              />
            </FormField>
            <FormField label="Name on this device">
              <Input bind:value={restoreName} />
            </FormField>
            <FormField label="Passphrase or recovery code">
              <Input type="password" bind:value={secret} autocomplete="current-password" />
            </FormField>
            <div class="flex gap-2">
              <Button type="submit" class="flex-1" disabled={busy || !backup || !secret}
                >Restore</Button
              >
              <Button
                variant="ghost"
                onclick={() => (mode = vaults?.length ? 'passphrase' : 'create')}>Back</Button
              >
            </div>
          </form>
        </Card.Content>
      </Card.Root>
    {:else}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg font-semibold"
            >{vaults.length > 1 ? 'Unlock a portfolio' : vault?.name}</Card.Title
          >
        </Card.Header>
        <Card.Content>
          <form class="grid gap-4" onsubmit={unlock}>
            {#if vaults.length > 1}
              <FormField label="Portfolio">
                <NativeSelect bind:value={chosen} class="w-full">
                  {#each vaults as v (v.vaultId)}<option value={v.vaultId}>{v.name}</option>{/each}
                </NativeSelect>
              </FormField>
            {/if}
            {#if mode === 'recovery'}
              <FormField label="Recovery code">
                <Input
                  bind:value={secret}
                  autocomplete="off"
                  autocapitalize="characters"
                  spellcheck="false"
                  placeholder="ABCD-EFGH-…"
                  class="font-mono"
                />
              </FormField>
            {:else}
              <FormField label="Passphrase">
                <Input type="password" bind:value={secret} autocomplete="current-password" />
              </FormField>
            {/if}
            <div class="flex gap-2">
              <Button type="submit" class="flex-1" disabled={busy || !secret}
                >{busy ? 'Unlocking…' : 'Unlock'}</Button
              >
              {#if canPasskey && vault?.passkeys.length}
                <Button variant="outline" onclick={fingerprint}
                  ><FingerprintPattern />Use fingerprint</Button
                >
              {/if}
            </div>
            {#if mode === 'recovery'}
              <Button
                variant="link"
                size="sm"
                class="justify-self-start px-0"
                onclick={() => (mode = 'passphrase')}>Use the passphrase</Button
              >
            {:else}
              <Button
                variant="link"
                size="sm"
                class="justify-self-start px-0"
                onclick={() => (mode = 'recovery')}>Forgot it? Use the recovery code</Button
              >
            {/if}
          </form>
        </Card.Content>
      </Card.Root>
      {@render others(['create', 'restore', 'sample'])}
    {/if}
  </div>
</div>
