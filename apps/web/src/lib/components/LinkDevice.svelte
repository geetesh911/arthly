<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- On a device with the portfolio open: scan or type the code a new device shows, confirm, and
     send it the portfolio through Google Drive. -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { api } from '#lib/api.ts';
  import { app, attempt, say } from '#lib/app.svelte.ts';
  import { ask } from '#lib/confirm.svelte.ts';
  import { readVideo } from '#lib/link.ts';

  import { Button } from './ui/button/index.ts';
  import { Input } from './ui/input/index.ts';
  import FormField from './FormField.svelte';

  let { onClose }: { onClose: () => void } = $props();
  let video = $state<HTMLVideoElement>();
  let camera = $state<'starting' | 'on' | 'off'>('starting');
  let typed = $state('');
  let busy = $state(false);
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** A scanned code that found nothing, so the same one isn't looked up again and again. */
  let refused = '';
  const canvas = document.createElement('canvas');

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      video!.srcObject = stream;
      await video!.play();
      camera = 'on';
      scan();
    } catch {
      stop();
      camera = 'off';
    }
  });

  onDestroy(stop);

  function stop() {
    clearTimeout(timer);

    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }

    stream = undefined;
  }

  function scan() {
    timer = setTimeout(async () => {
      if (!stream || !video) {
        return;
      }

      const text = await readVideo(video, canvas).catch(() => null);

      if (text && text !== refused && !busy) {
        refused = (await use(text)) ? '' : text;
      }

      if (stream) {
        scan();
      }
    }, 250);
  }

  /** Looks up the code, asks to confirm and links. False when the code found nothing. */
  async function use(text: string): Promise<boolean> {
    busy = true;
    const found = await attempt(() => api().findLink(text));

    if (!found) {
      busy = false;

      return false;
    }

    stop();
    const name = app.vault?.name ?? 'this portfolio';
    const ok = await ask({
      title: `Link ${found.device}?`,
      description: `It will open ${name} and keep it in sync through your Google Drive. Only link your own devices.`,
      action: 'Link',
    });

    if (ok && (await attempt(() => api().approveLink(found.code)))) {
      say(`Linked. ${name} is opening on ${found.device}.`);
    }

    busy = false;
    onClose();

    return true;
  }

  function submit(event: Event) {
    event.preventDefault();
    void use(typed);
  }
</script>

<div class="grid gap-4 rounded-2xl border p-4">
  <p class="text-sm font-medium">Link a device</p>
  {#if camera !== 'off'}
    <div class="relative mx-auto aspect-square w-full max-w-72 overflow-hidden rounded-xl bg-black">
      <video bind:this={video} class="size-full object-cover" playsinline muted></video>
      {#if camera === 'starting'}
        <p class="absolute inset-0 grid place-items-center text-sm text-white/80">
          Starting the camera…
        </p>
      {/if}
      <div
        class="pointer-events-none absolute inset-[15%] rounded-lg border-2 border-white/80"
      ></div>
    </div>
    <p class="text-muted-foreground text-sm">
      On the new device, choose <strong>Link with another device</strong> where it asks to unlock, and
      point this camera at the code it shows.
    </p>
  {:else}
    <p class="text-muted-foreground text-sm">
      On the new device, choose <strong>Link with another device</strong> where it asks to unlock. The
      camera isn’t available here, so type the code it shows.
    </p>
  {/if}
  <form class="grid gap-3" onsubmit={submit}>
    <FormField label={camera === 'off' ? 'Code' : 'Or type the code'}>
      <Input
        bind:value={typed}
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        placeholder="ABCD-EFGH-…"
        class="font-mono"
      />
    </FormField>
    <div class="flex gap-2">
      <Button type="submit" disabled={busy || !typed.trim()}>{busy ? 'Linking…' : 'Link'}</Button>
      <Button variant="ghost" onclick={onClose}>Cancel</Button>
    </div>
  </form>
</div>
