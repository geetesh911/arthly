<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { version } from '$app/env';
  import Download from '@lucide/svelte/icons/download';
  import FingerprintPattern from '@lucide/svelte/icons/fingerprint-pattern';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Moon from '@lucide/svelte/icons/moon';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Sun from '@lucide/svelte/icons/sun';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { Group } from '@pv/core';

  import { api, list } from '#lib/api.ts';
  import { app, attempt, changed, lock, say } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import NameRow from '#lib/components/NameRow.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import RecoveryCode from '#lib/components/RecoveryCode.svelte';
  import * as Alert from '#lib/components/ui/alert/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import * as ToggleGroup from '#lib/components/ui/toggle-group/index.ts';
  import { ask } from '#lib/confirm.svelte.ts';
  import { saveFile } from '#lib/files.ts';
  import { date } from '#lib/format.ts';
  import { enrolPasskey, passkeysSupported } from '#lib/passkey.ts';
  import { readTheme, setTheme, type Theme } from '#lib/theme.ts';
  import type { AccountDto, BatchDto, UnlockMethodDto } from '#lib/worker/dto.ts';

  let methods = $state<UnlockMethodDto[]>([]);
  let accounts = $state<AccountDto[]>([]);
  let batches = $state<BatchDto[]>([]);
  let groups = $state<Group[]>([]);
  let autoLock = $state(5);
  let feedUrl = $state('');
  let newMember = $state('');
  let newPass = $state('');
  let newPass2 = $state('');
  let code = $state('');
  let canPasskey = $state(false);
  let persisted = $state<boolean | null>(null);
  let groupName = $state('');
  let theme = $state<Theme>(readTheme());

  async function load() {
    [methods, accounts, batches, groups, autoLock, feedUrl] = await Promise.all([
      api().unlockMethods(),
      api().accounts(),
      api().batches(),
      list('group'),
      api().autoLockMinutes(),
      api().feedUrl(),
    ]);
  }

  onMount(async () => {
    await load();
    canPasskey = await passkeysSupported();
    persisted = (await navigator.storage?.persisted?.()) ?? null;
  });

  async function run(action: () => Promise<unknown>, message: string): Promise<boolean> {
    if ((await attempt(action)) === undefined) {
      return false;
    }

    say(message);
    await changed();
    await load();

    return true;
  }

  async function exportAs(kind: 'excel' | 'json') {
    const ok = await ask({
      title: 'Export without encryption?',
      description:
        'Excel and JSON files are not encrypted. Anyone who opens the file can read your holdings.',
      action: 'Export',
    });

    if (!ok) {
      return;
    }

    const file = await attempt(() => api().exportFile(kind));

    if (file) {
      saveFile(file);
    }
  }

  async function backup() {
    const file = await attempt(() => api().backup());

    if (file) {
      saveFile(file);
      say('Backup saved. It is encrypted with your passphrase.');
      await changed();
    }
  }

  async function addPasskey() {
    await run(async () => {
      const key = await enrolPasskey(app.vault?.name ?? 'Arthly');

      await api().addPasskey(
        key.credentialId,
        key.prfSalt,
        key.prfOutput,
        navigator.platform || 'This device',
      );
    }, 'Fingerprint unlock is on for this device');
  }

  async function changePass(event: Event) {
    event.preventDefault();

    if (newPass.length < 10 || newPass !== newPass2) {
      return say('Use at least 10 characters, typed the same twice');
    }

    await run(() => api().changePassphrase(newPass), 'Passphrase changed');
    newPass = newPass2 = '';
  }

  async function newCode() {
    const ok = await ask({
      title: 'Make a new recovery code?',
      description: 'The old one stops working.',
      action: 'Make a new code',
    });

    if (!ok) {
      return;
    }

    const c = await attempt(() => api().replaceRecoveryCode());

    if (c) {
      code = c;
    }

    await load();
  }

  async function addMember(event: Event) {
    event.preventDefault();

    if (!newMember.trim()) {
      return;
    }

    await run(
      () =>
        api().save('member', {
          id: `mem_${crypto.randomUUID().slice(0, 12)}`,
          name: newMember.trim(),
        }),
      'Member added',
    );
    newMember = '';
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function accountsOf(memberId: string) {
    const n = accounts.filter((a) => a.memberId === memberId).length;

    return n ? plural(n, 'account') : 'No accounts';
  }

  async function removeAccount(a: AccountDto) {
    const records = [
      a.transactions && plural(a.transactions, 'transaction'),
      a.balances && plural(a.balances, 'statement balance'),
    ].filter(Boolean);
    const ok = await ask({
      title: `Remove ${a.label}?`,
      description: records.length
        ? `This also removes its ${records.join(' and ')}. Records from files come back if you import those files again.`
        : 'It holds no records.',
      action: 'Remove',
      destructive: true,
    });

    if (ok) {
      await run(() => api().removeAccount(a.id), 'Account removed');
    }
  }

  async function addGroup(event: Event) {
    event.preventDefault();

    if (!groupName.trim()) {
      return;
    }

    await run(
      () =>
        api().save('group', {
          id: `grp_${crypto.randomUUID().slice(0, 12)}`,
          name: groupName.trim(),
          holdings: [],
        }),
      'Group added',
    );
    groupName = '';
  }

  async function undoImport(batchId: string) {
    const ok = await ask({
      title: 'Undo this import?',
      description: 'Records you edited since are kept.',
      action: 'Undo',
    });

    if (ok) {
      await run(() => api().revertImport(batchId), 'Import undone');
    }
  }

  async function forget() {
    if (!app.vault) {
      return;
    }

    const ok = await ask({
      title: `Remove "${app.vault.name}" from this device?`,
      description: 'Without a backup or sync, its data is gone for good.',
      action: 'Remove',
      destructive: true,
    });

    if (!ok) {
      return;
    }

    const id = app.vault.vaultId;

    await lock();
    await api().removeVault(id);
  }
</script>

{#snippet title(text: string, description?: string)}
  <Card.Header>
    <Card.Title class="text-lg font-semibold">{text}</Card.Title>
    {#if description}<Card.Description>{description}</Card.Description>{/if}
  </Card.Header>
{/snippet}

<PageHeader title="Settings" back={{ href: '#/more', label: 'More' }} backClass="lg:hidden" />

<!-- Two independent columns, so a long list on one side leaves no gap on the other. -->
<div class="grid items-start gap-4 lg:grid-cols-2">
  <div class="flex flex-col gap-4">
    <Card.Root>
      {@render title(
        'Backup and export',
        'A backup (.pvault) restores everything on any device with your passphrase or recovery code. Cloud sync comes in a later version.',
      )}
      <Card.Content class="grid gap-4">
        {#if persisted === false}
          <Alert.Root>
            <TriangleAlert />
            <Alert.Description>
              This browser may clear the app's data when space runs low. Make backups, or install
              the app to the home screen.
            </Alert.Description>
          </Alert.Root>
        {/if}
        <div class="flex flex-wrap gap-2">
          <Button onclick={backup}><Download />Save an encrypted backup</Button>
          <Button variant="outline" onclick={() => exportAs('excel')}>Export to Excel</Button>
          <Button variant="outline" onclick={() => exportAs('json')}>Export to JSON</Button>
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      {@render title('Members', 'A member can be removed once their accounts are gone.')}
      <Card.Content class="grid gap-4">
        <ul class="divide-y rounded-2xl border" aria-label="Members">
          {#each app.members as m (m.id)}
            <NameRow
              name={m.name}
              detail={accountsOf(m.id)}
              onRename={(name) => run(() => api().rename('member', m.id, name), 'Renamed')}
              onRemove={() => run(() => api().removeMember(m.id), `${m.name} removed`)}
            />
          {/each}
        </ul>
        <form class="flex gap-2" onsubmit={addMember}>
          <Input bind:value={newMember} placeholder="Name" aria-label="New member" />
          <Button type="submit" variant="outline">Add</Button>
        </form>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      {@render title(
        'Accounts',
        'Imports and the add forms make these. Removing one also removes its records.',
      )}
      <Card.Content>
        {#if accounts.length === 0}
          <p class="text-muted-foreground text-sm">No accounts yet.</p>
        {:else}
          <ul class="divide-y rounded-2xl border" aria-label="Accounts">
            {#each accounts as a (a.id)}
              <NameRow
                name={a.label}
                detail={[a.member, a.institution].filter(Boolean).join(' · ')}
                onRename={(name) => run(() => api().rename('account', a.id, name), 'Renamed')}
                onRemove={() => removeAccount(a)}
              />
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      {@render title(
        'Groups',
        'Groups such as a smallcase or "retirement" bring holdings together. Add holdings to a group from the holding’s page.',
      )}
      <Card.Content class="grid gap-4">
        {#if groups.length}
          <ul class="divide-y rounded-2xl border">
            {#each groups as g (g.id)}
              <li class="flex items-center justify-between px-4 py-2.5 text-sm">
                <span class="font-medium">{g.name}</span>
                <span class="text-muted-foreground text-xs">{g.holdings.length} holdings</span>
              </li>
            {/each}
          </ul>
        {/if}
        <form class="flex gap-2" onsubmit={addGroup}>
          <Input bind:value={groupName} placeholder="Group name" aria-label="New group" />
          <Button type="submit" variant="outline">Add</Button>
        </form>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      {@render title('History of imports')}
      <Card.Content>
        {#if batches.length === 0}
          <p class="text-muted-foreground text-sm">No imports yet.</p>
        {:else}
          <ul class="divide-y rounded-2xl border">
            {#each batches as b (b.batchId)}
              <li class="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{b.fileName}</span>
                  <span class="text-muted-foreground block text-xs"
                    >{date(b.date)} · {b.records} records{b.reverted ? ' · undone' : ''}{b.kept
                      ? ` · ${b.kept} edited since, kept`
                      : ''}</span
                  >
                </span>
                {#if !b.reverted}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-destructive"
                    onclick={() => undoImport(b.batchId)}>Undo</Button
                  >
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <div class="flex flex-col gap-4">
    <Card.Root>
      {@render title('Unlocking')}
      <Card.Content class="grid gap-5">
        <ul class="divide-y rounded-2xl border">
          {#each methods as m (m.id)}
            <li class="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span class="min-w-0 flex-1">
                {m.type === 'passphrase'
                  ? 'Passphrase'
                  : m.type === 'recovery'
                    ? 'Recovery code'
                    : `Passkey: ${m.label}`}
                <span class="text-muted-foreground block text-xs">since {date(m.updated)}</span>
              </span>
              {#if m.type === 'passkey'}
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-destructive"
                  onclick={() => run(() => api().removeUnlockMethod(m.id), 'Passkey removed')}
                  >Remove</Button
                >
              {/if}
            </li>
          {/each}
        </ul>
        {#if canPasskey}
          <Button variant="outline" class="justify-self-start" onclick={addPasskey}
            ><FingerprintPattern />Add fingerprint / Face ID on this device</Button
          >
        {/if}
        <form class="grid gap-4" onsubmit={changePass}>
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField label="New passphrase">
              <Input type="password" bind:value={newPass} autocomplete="new-password" />
            </FormField>
            <FormField label="Type it again">
              <Input type="password" bind:value={newPass2} autocomplete="new-password" />
            </FormField>
          </div>
          <Button type="submit" variant="outline" class="justify-self-start"
            >Change passphrase</Button
          >
        </form>
        <div class="grid gap-3">
          <Button variant="link" class="justify-self-start px-0" onclick={newCode}
            >Make a new recovery code</Button
          >
          {#if code}
            <RecoveryCode {code} />
            <p class="text-sm">Write this down now. It's shown only once.</p>
          {/if}
        </div>
        <FormField label="Lock after this many idle minutes (1–60)">
          <Input
            type="number"
            min="1"
            max="60"
            class="w-28"
            bind:value={autoLock}
            onchange={() => run(() => api().setAutoLock(autoLock), 'Saved')}
          />
        </FormField>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      {@render title('Appearance', 'Saved on this device only.')}
      <Card.Content>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          bind:value={theme}
          onValueChange={(v) => {
            if (v) {
              setTheme(v as Theme);
            } else {
              theme = readTheme();
            }
          }}
          aria-label="Theme"
        >
          <ToggleGroup.Item value="system"><Monitor />System</ToggleGroup.Item>
          <ToggleGroup.Item value="light"><Sun />Light</ToggleGroup.Item>
          <ToggleGroup.Item value="dark"><Moon />Dark</ToggleGroup.Item>
        </ToggleGroup.Root>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      {@render title(
        'Prices',
        'Fund NAVs come from AMFI and stock prices from NSE (or BSE), through this app’s relay on Cloudflare; the USD rate comes from Frankfurter. Only whole price files are fetched, so no one learns what you hold.',
      )}
      <Card.Content class="grid gap-4">
        <FormField
          label="Price feed address (optional)"
          hint="Leave this blank to use the relay. Fill it in only if you run your own price feed."
          ><Input bind:value={feedUrl} /></FormField
        >
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onclick={() =>
              run(() => api().save('setting', { id: 'feedUrl', value: feedUrl.trim() }), 'Saved')}
            >Save</Button
          >
          <Button
            variant="outline"
            onclick={() =>
              run(async () => {
                const r = await api().refreshPrices(true);

                if (!r.ok) {
                  throw new Error(r.message);
                }
              }, 'Prices updated')}><RefreshCw />Update prices now</Button
          >
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      {@render title(
        'About',
        `Version ${version}. Open source under AGPL-3.0. No analytics, no outside scripts: everything runs on this device.`,
      )}
      <Card.Content>
        <Button variant="destructive" onclick={forget}
          >Remove this portfolio from this device</Button
        >
      </Card.Content>
    </Card.Root>
  </div>
</div>
