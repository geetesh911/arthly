<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import FileQuestion from '@lucide/svelte/icons/file-question';
  import FileUp from '@lucide/svelte/icons/file-up';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';

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
  // Once the last file is through, Holdings shows what came in, if anything did.
  let imported = false;

  async function next(done = false) {
    plan = null;
    imported ||= done;
    const file = queue[0];

    if (!file) {
      if (imported) {
        imported = false;
        await goto('#/holdings');
      }

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

    await goto('#/import', { replaceState: true });
    await add(files);
  });

  async function template() {
    const file = await attempt(() => api().exportFile('template'));

    if (file) {
      saveFile(file);
    }
  }
</script>

<PageHeader title="Import" description="Files are read on this device and never uploaded." />

{#if plan}
  <ImportPreview {plan} onDone={next} />
{:else}
  <Card.Root class="max-w-2xl">
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
      <p class="text-muted-foreground text-sm">
        Groww mutual-fund and stock holdings or order history, Bank of Baroda PPF statements, EPFO
        passbook PDFs, or this app's own Excel, template or JSON export, or a zip of any of these.
      </p>
      {#if app.members.length > 1}
        <FormField label="Whose files are these?">
          <NativeSelect bind:value={memberId} class="w-full">
            {#each app.members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
          </NativeSelect>
        </FormField>
      {/if}
      <p class="text-muted-foreground text-sm">
        <Button variant="link" class="h-auto p-0" onclick={template}
          >Download a blank template</Button
        > to fill in many records at once.
      </p>
    </Card.Content>
  </Card.Root>

  {#if unknown}
    <Alert.Root class="max-w-2xl">
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
