<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- One row of a Settings list that can be renamed in place or removed. -->
<script lang="ts">
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash from '@lucide/svelte/icons/trash';
  import X from '@lucide/svelte/icons/x';

  import { Button } from '#lib/components/ui/button/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';

  let {
    name,
    detail,
    onRename,
    onRemove,
  }: {
    name: string;
    detail?: string;
    /** Resolves true once the new name is saved. */
    onRename: (name: string) => Promise<boolean>;
    onRemove: () => void;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (editing) {
      input?.select();
    }
  });

  async function submit(event: Event) {
    event.preventDefault();

    if (draft.trim() === name || (await onRename(draft))) {
      editing = false;
    }
  }
</script>

<li class="flex min-h-14 items-center gap-1 py-2 pr-2 pl-4 text-sm">
  {#if editing}
    <form class="flex min-w-0 flex-1 items-center gap-1" onsubmit={submit}>
      <Input
        bind:ref={input}
        bind:value={draft}
        class="min-w-0 flex-1"
        aria-label={`New name for ${name}`}
        onkeydown={(e) => e.key === 'Escape' && (editing = false)}
      />
      <Button type="submit" class="ml-1">Save</Button>
      <Button
        variant="ghost"
        size="icon"
        title="Cancel"
        aria-label="Cancel"
        onclick={() => (editing = false)}><X /></Button
      >
    </form>
  {:else}
    <span class="min-w-0 flex-1">
      <span class="block font-medium break-words">{name}</span>
      {#if detail}<span class="text-muted-foreground block text-xs break-words">{detail}</span>{/if}
    </span>
    <Button
      variant="ghost"
      size="icon"
      title="Rename"
      aria-label={`Rename ${name}`}
      onclick={() => {
        draft = name;
        editing = true;
      }}><Pencil /></Button
    >
    <Button
      variant="ghost"
      size="icon"
      class="text-destructive"
      title="Remove"
      aria-label={`Remove ${name}`}
      onclick={onRemove}><Trash /></Button
    >
  {/if}
</li>
