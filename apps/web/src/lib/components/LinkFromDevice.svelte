<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- On a new device: sign in to Google, show a code for a device that has the portfolio open to
     scan, and open the portfolio once it answers. -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { formatLinkCode, type GoogleGrant, linkQrText } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { attempt, opened, say } from '#lib/app.svelte.ts';
  import { prepareGoogle, signInWithGoogle } from '#lib/google.ts';
  import { deviceName, qrCode } from '#lib/link.ts';
  import type { LinkStartDto } from '#lib/worker/dto.ts';

  import { Button } from './ui/button/index.ts';
  import * as Card from './ui/card/index.ts';

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
  let busy = $state(false);
  let link = $state<LinkStartDto | null>(null);
  /** Why the code stopped working, once it has. */
  let ended = $state<'expired' | 'failed' | null>(null);
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking = false;
  const qr = $derived(link ? qrCode(linkQrText(link.code)) : null);

  onMount(async () => {
    setUp = await prepareGoogle();

    if (grant) {
      await start(grant);
    }
  });

  // Leaving takes the request out of Drive; after the portfolio opens there's nothing left to take.
  onDestroy(() => {
    clearInterval(timer);

    if (link) {
      void api().cancelLink();
    }
  });

  // Google's page has to open from the click itself, so nothing is awaited before it.
  function signIn() {
    const controller = new AbortController();
    const pending = signInWithGoogle('link', controller.signal);

    waiting = controller;

    void (async () => {
      const g = await attempt(() => pending);

      waiting = null;

      if (g) {
        await start(g);
      }
    })();
  }

  /** Makes a code, with a new sign-in or the last one. */
  async function start(g: GoogleGrant | null) {
    busy = true;
    const started = await attempt(() => api().startLink(g, deviceName(navigator.userAgent)));

    busy = false;

    if (started) {
      link = started;
      ended = null;
      clearInterval(timer);
      timer = setInterval(() => void check(), 2000);
    }
  }

  async function check() {
    if (checking) {
      return;
    }

    checking = true;
    const state = await attempt(() => api().checkLink());

    checking = false;

    if (state === 'waiting') {
      return;
    }

    clearInterval(timer);

    if (state === 'opened') {
      await opened();
      say('Linked. This device now syncs with your other devices.');
    } else {
      ended = state ?? 'failed';
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Link with another device</Card.Title>
    <Card.Description>
      {link
        ? 'Scan this code from a device where your portfolio is open.'
        : 'Sign in to the Google account your portfolio syncs to. Then scan a code from a device where it’s open, without typing your passphrase.'}
    </Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if !link || !qr}
      {#if setUp === false}
        <p class="text-muted-foreground text-sm">
          Google Drive isn’t set up for this copy of Arthly.
        </p>
      {/if}
      <div class="flex gap-2">
        <Button class="flex-1" onclick={signIn} disabled={!setUp || !!waiting || busy}
          >{busy ? 'Making a code…' : 'Sign in with Google'}</Button
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
    {:else if ended}
      <p class="text-sm">
        {ended === 'expired'
          ? 'This code has expired.'
          : 'This code didn’t work. Make a new one to try again.'}
      </p>
      <div class="flex gap-2">
        <Button class="flex-1" onclick={() => start(null)} disabled={busy}
          >{busy ? 'Making a code…' : 'Make a new code'}</Button
        >
        <Button variant="ghost" onclick={onBack}>Back</Button>
      </div>
    {:else}
      <svg
        viewBox="0 0 {qr.size} {qr.size}"
        class="mx-auto w-full max-w-60 rounded-xl"
        shape-rendering="crispEdges"
        role="img"
        aria-label="QR code to link this device"
      >
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.path} fill="#000" />
      </svg>
      <p class="text-center font-mono text-lg tracking-wider" data-testid="link-code">
        {formatLinkCode(link.code)}
      </p>
      <ol class="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
        <li>On a device where your portfolio is open, go to Settings → Cloud sync.</li>
        <li>Choose <strong>Link a device</strong>, then scan this code or type it.</li>
      </ol>
      <p class="text-muted-foreground text-xs">
        {link.account ? `Signed in to Google as ${link.account}. ` : ''}The other device has to sync
        with the same Google account. Once linked, this device unlocks like any other: with your
        passphrase, or a fingerprint you add in Settings.
      </p>
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm" aria-live="polite">Waiting for the other device…</p>
        <Button variant="ghost" onclick={onBack}>Cancel</Button>
      </div>
    {/if}
  </Card.Content>
</Card.Root>
