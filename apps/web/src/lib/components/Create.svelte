<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import FingerprintPattern from '@lucide/svelte/icons/fingerprint-pattern';

  import { api } from '#lib/api.ts';
  import { attempt, opened, say } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import RecoveryCode from '#lib/components/RecoveryCode.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { enrolPasskey, passkeysSupported } from '#lib/passkey.ts';

  let { onCancel }: { onCancel?: (() => void) | undefined } = $props();

  let step = $state<'name' | 'passphrase' | 'code' | 'passkey'>('name');
  let name = $state('My portfolio');
  let memberName = $state('');
  let pass1 = $state('');
  let pass2 = $state('');
  let code = $state('');
  let retyped = $state('');
  let busy = $state(false);
  let canPasskey = $state(false);

  const STEPS = ['name', 'passphrase', 'code', 'passkey'] as const;
  const strongEnough = $derived(pass1.length >= 10 && pass1 === pass2);
  const codeMatches = $derived(
    retyped.toUpperCase().replace(/[^A-Z2-7]/g, '') === code.replace(/-/g, ''),
  );

  async function create(event: Event) {
    event.preventDefault();
    busy = true;
    const result = await attempt(() =>
      api().create(name.trim() || 'My portfolio', memberName.trim() || 'Me', pass1),
    );

    busy = false;

    if (!result) {
      return;
    }

    pass1 = pass2 = '';
    code = result.recoveryCode;
    step = 'code';
    canPasskey = await passkeysSupported();
  }

  async function addPasskey() {
    const done = await attempt(async () => {
      const key = await enrolPasskey(name);

      await api().addPasskey(
        key.credentialId,
        key.prfSalt,
        key.prfOutput,
        navigator.platform || 'This device',
      );

      return true;
    });

    if (done) {
      say('Fingerprint unlock is on for this device');
    }

    await finish();
  }

  async function finish() {
    code = '';
    await opened();
    await goto('#/import');
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Description>Step {STEPS.indexOf(step) + 1} of 4</Card.Description>
    <Card.Title class="text-lg font-semibold">
      {step === 'name'
        ? 'New portfolio'
        : step === 'passphrase'
          ? 'Choose a passphrase'
          : step === 'code'
            ? 'Your recovery code'
            : 'Unlock with your fingerprint?'}
    </Card.Title>
  </Card.Header>
  <Card.Content>
    {#if step === 'name'}
      <form
        class="grid gap-4"
        onsubmit={(e) => {
          e.preventDefault();
          step = 'passphrase';
        }}
      >
        <FormField label="Name of this portfolio"><Input bind:value={name} /></FormField>
        <FormField label="Your name (you can add family members later)">
          <Input bind:value={memberName} placeholder="Me" />
        </FormField>
        <div class="flex gap-2">
          <Button type="submit" class="flex-1">Next</Button>
          {#if onCancel}<Button variant="ghost" onclick={onCancel}>Back</Button>{/if}
        </div>
      </form>
    {:else if step === 'passphrase'}
      <form class="grid gap-4" onsubmit={create}>
        <p class="text-muted-foreground text-sm">
          It encrypts your data on this device. Four or more random words is a good choice. Nobody
          can reset it for you.
        </p>
        <FormField label="Passphrase (at least 10 characters)">
          <Input type="password" bind:value={pass1} autocomplete="new-password" />
        </FormField>
        <FormField label="Type it again">
          <Input
            type="password"
            bind:value={pass2}
            autocomplete="new-password"
            aria-invalid={pass2 && pass1 !== pass2 ? true : undefined}
          />
        </FormField>
        {#if pass2 && pass1 !== pass2}<p class="text-destructive text-sm">
            The two don't match.
          </p>{/if}
        <div class="flex gap-2">
          <Button type="submit" class="flex-1" disabled={!strongEnough || busy}
            >{busy ? 'Creating…' : 'Create'}</Button
          >
          <Button variant="ghost" onclick={() => (step = 'name')}>Back</Button>
        </div>
      </form>
    {:else if step === 'code'}
      <form
        class="grid gap-4"
        onsubmit={(e) => {
          e.preventDefault();
          step = 'passkey';
        }}
      >
        <p class="text-sm">
          If you forget the passphrase, this code is the only other way in. Write it down and keep
          it somewhere safe. It's shown only once.
        </p>
        <RecoveryCode {code} />
        <FormField label="Type the code to confirm you've saved it">
          <Input
            bind:value={retyped}
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            class="font-mono"
          />
        </FormField>
        <Button type="submit" disabled={!codeMatches}>I've saved it</Button>
      </form>
    {:else}
      <div class="grid gap-4">
        {#if canPasskey}
          <p class="text-muted-foreground text-sm">
            Adds a passkey on this device, so you don't have to type the passphrase each time.
          </p>
          <div class="flex gap-2">
            <Button class="flex-1" onclick={addPasskey}><FingerprintPattern />Turn on</Button>
            <Button variant="ghost" onclick={finish}>Not now</Button>
          </div>
        {:else}
          <p class="text-muted-foreground text-sm">
            This browser can't unlock with a passkey. You'll use the passphrase.
          </p>
          <Button onclick={finish}>Continue</Button>
        {/if}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
