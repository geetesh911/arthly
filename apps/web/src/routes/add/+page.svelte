<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import FileQuestion from '@lucide/svelte/icons/file-question';
  import FileUp from '@lucide/svelte/icons/file-up';
  import HandCoins from '@lucide/svelte/icons/hand-coins';
  import Landmark from '@lucide/svelte/icons/landmark';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import PiggyBank from '@lucide/svelte/icons/piggy-bank';
  import Tag from '@lucide/svelte/icons/tag';

  import { api } from '#lib/api.ts';
  import { app, attempt } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import ImportPreview from '#lib/components/ImportPreview.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import * as Alert from '#lib/components/ui/alert/index.ts';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { openZips, readFile, saveFile } from '#lib/files.ts';
  import { cn } from '#lib/utils.ts';
  import type { PlanDto } from '#lib/worker/dto.ts';

  let memberId = $state(app.filter.memberId ?? app.members[0]?.id ?? '');
  let queue = $state<File[]>([]);
  let plan = $state<PlanDto | null>(null);
  let unknown = $state<{ name: string; headings: string[] } | null>(null);
  let dragging = $state(false);
  let busy = $state(false);

  const byHand = [
    { href: '#/add/transaction', label: 'Transaction', icon: ArrowLeftRight },
    { href: '#/add/fd', label: 'FD, bond or SGB', icon: Landmark },
    { href: '#/add/balance', label: 'PPF, EPF or cash', icon: PiggyBank },
    { href: '#/add/price', label: 'Price', icon: Tag },
    { href: '#/loans/new', label: 'Loan', icon: HandCoins },
  ];

  async function next() {
    plan = null;
    const file = queue[0];

    if (!file) {
      return;
    }

    queue = queue.slice(1);
    busy = true;
    const result = await attempt(async () =>
      api().prepareImport(file.name, await readFile(file), memberId),
    );

    busy = false;

    if (!result) {
      return next();
    }

    if (result.kind === 'plan') {
      plan = result.plan;
    } else {
      unknown = { name: file.name, headings: result.headings };
    }
  }

  async function add(files: Iterable<File> | null | undefined) {
    const list = [...(files ?? [])];

    if (!list.length) {
      return;
    }

    unknown = null;
    const opened = await attempt(() => openZips(list));

    if (!opened) {
      return;
    }

    queue = [...queue, ...opened];

    if (!plan && !busy) {
      void next();
    }
  }

  // Files shared from another app arrive through the service worker.
  onMount(async () => {
    if (!location.hash.includes('shared=') || !('caches' in window)) {
      return;
    }

    const cache = await caches.open('shared-files');
    const files: File[] = [];

    for (const request of await cache.keys()) {
      const res = await cache.match(request);

      if (res) {
        files.push(
          new File(
            [await res.blob()],
            decodeURIComponent(res.headers.get('x-name') ?? 'shared.xlsx'),
          ),
        );
      }

      await cache.delete(request);
    }

    await goto('#/add', { replaceState: true });
    await add(files);
  });

  async function template() {
    const file = await attempt(() => api().exportFile('template'));

    if (file) {
      saveFile(file);
    }
  }
</script>

<PageHeader title="Add" />

{#if plan}
  <ImportPreview {plan} onDone={next} />
{:else}
  <div class="grid gap-4 lg:grid-cols-5">
    <Card.Root class="lg:col-span-3">
      <Card.Header>
        <Card.Title class="text-lg font-semibold">Import files</Card.Title>
        <Card.Description>
          Groww mutual-fund holdings, Groww stock holdings, Bank of Baroda PPF statements, EPFO
          passbook PDFs, or this app's own Excel, template or JSON export, or a zip of any of these.
          Files are read on this device and never uploaded.
        </Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <label
          aria-label="Import files"
          class={cn(
            'flex cursor-pointer flex-col items-center gap-3 rounded-3xl border-2 border-dashed p-8 text-center transition-[color,background-color,border-color,box-shadow]',
            // The file input itself is hidden, so the drop zone shows its keyboard focus.
            'has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-ring/50 has-[input:focus-visible]:ring-3',
            dragging ? 'border-brand bg-brand/5' : 'hover:bg-muted/50',
          )}
          ondragover={(e) => {
            e.preventDefault();
            dragging = true;
          }}
          ondragleave={() => (dragging = false)}
          ondrop={(e) => {
            e.preventDefault();
            dragging = false;
            add(e.dataTransfer?.files);
          }}
        >
          <span
            class="bg-secondary text-secondary-foreground grid size-12 place-items-center rounded-full"
          >
            {#if busy}<LoaderCircle class="size-6 animate-spin" />{:else}<FileUp
                class="size-6"
              />{/if}
          </span>
          <span class={buttonVariants()}>{busy ? 'Reading…' : 'Choose files'}</span>
          <span class="text-muted-foreground text-xs">Or drop files here.</span>
          <input
            class="sr-only"
            type="file"
            multiple
            accept=".xlsx,.xls,.csv,.json,.pdf,.zip"
            onchange={(e) => add(e.currentTarget.files)}
            data-testid="import-input"
          />
        </label>
        {#if app.members.length > 1}
          <FormField label="Whose files are these?">
            <NativeSelect bind:value={memberId} class="w-full">
              {#each app.members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
            </NativeSelect>
          </FormField>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root class="lg:col-span-2">
      <Card.Header>
        <Card.Title class="text-lg font-semibold">Add by hand</Card.Title>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid grid-cols-2 gap-3">
          {#each byHand as item (item.href)}
            <a
              href={item.href}
              class="hover:bg-muted flex flex-col gap-3 rounded-3xl border p-4 text-sm font-medium transition-colors"
            >
              <item.icon class="text-brand size-5" />
              {item.label}
            </a>
          {/each}
        </div>
        <p class="text-muted-foreground text-sm">
          <Button variant="link" class="h-auto p-0" onclick={template}
            >Download a blank template</Button
          > to fill in many records at once.
        </p>
      </Card.Content>
    </Card.Root>
  </div>

  {#if unknown}
    <Alert.Root>
      <FileQuestion />
      <Alert.Title>No importer recognises {unknown.name}</Alert.Title>
      <Alert.Description class="grid gap-3">
        <p>
          A fund house’s monthly portfolio? Add it in <a
            href="#/analytics"
            class="underline underline-offset-4">Analytics</a
          >, under fund underlying holdings.
        </p>
        <p>To ask for one, share these column headings (no values) when you open an issue:</p>
        <code class="bg-muted rounded-xl p-3 font-mono text-xs break-words"
          >{unknown.headings.join(' | ') || '(no headings found)'}</code
        >
        <Button
          variant="outline"
          size="sm"
          class="justify-self-start"
          onclick={() => navigator.clipboard.writeText(unknown!.headings.join('\t'))}
          >Copy headings</Button
        >
      </Alert.Description>
    </Alert.Root>
  {/if}
{/if}
