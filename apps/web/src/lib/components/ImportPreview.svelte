<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Info from '@lucide/svelte/icons/info';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  import { api } from '#lib/api.ts';
  import { attempt, changed, say } from '#lib/app.svelte.ts';
  import * as Alert from '#lib/components/ui/alert/index.ts';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
  import { date, inr } from '#lib/format.ts';
  import type { PlanDto } from '#lib/worker/dto.ts';

  let { plan, onDone }: { plan: PlanDto; onDone: () => void } = $props();

  // The preview starts from the plan it was given; later changes come from replanning here.
  let current = $state(untrack(() => plan));
  let excluded = $state<number[]>(
    untrack(() => plan.items.filter((i) => !i.include && i.status !== 'same').map((i) => i.index)),
  );
  let rejected = $state<string[]>([]);
  let busy = $state(false);
  let showAll = $state(false);

  const changes = $derived(current.items.filter((i) => i.status !== 'same'));
  const counts = $derived({
    new: changes.filter((i) => i.status === 'new').length,
    changed: changes.filter((i) => i.status === 'changed').length,
    duplicate: changes.filter((i) => i.status === 'duplicate').length,
    same: current.items.length - changes.length,
  });

  function toggle(index: number) {
    excluded = excluded.includes(index)
      ? excluded.filter((i) => i !== index)
      : [...excluded, index];
  }

  async function reject(ref: string) {
    rejected = [...rejected, ref];
    const next = await attempt(() => api().replan(current.planId, $state.snapshot(rejected)));

    if (next) {
      current = next;
    }
  }

  async function confirm() {
    busy = true;
    const result = await attempt(() =>
      api().confirmImport(current.planId, $state.snapshot(excluded)),
    );

    busy = false;

    if (!result) {
      return;
    }

    say(result.written ? `Imported ${current.fileName}` : 'Already up to date');
    await changed();
    onDone();
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold break-all">{current.fileName}</Card.Title>
    <Card.Description>
      {current.importer}{current.asOf ? ` · as of ${date(current.asOf)}` : ''}
    </Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if current.upToDate}
      <p class="flex items-center gap-2 text-sm">
        <CircleCheck class="text-gain size-4" />Already up to date. Nothing new in this file.
      </p>
      <Button class="justify-self-start" onclick={onDone}>Done</Button>
    {:else}
      <div class="grid gap-2">
        <div class="flex flex-wrap gap-2">
          <Badge>{counts.new} new</Badge>
          {#if counts.changed}<Badge variant="secondary">{counts.changed} changed</Badge>{/if}
          {#if counts.duplicate}<Badge variant="outline"
              >{counts.duplicate} possible duplicates</Badge
            >{/if}
          {#if counts.same}<Badge variant="outline">{counts.same} already there</Badge>{/if}
        </div>
        <p class="text-muted-foreground text-sm">
          {counts.new} new, {counts.changed} changed{counts.duplicate
            ? `, ${counts.duplicate} possible duplicates (unticked)`
            : ''}{counts.same ? `, ${counts.same} already there` : ''}.
        </p>
      </div>

      {#if current.totals}
        <Alert.Root variant={current.totals.ok ? 'default' : 'destructive'}>
          {#if current.totals.ok}<CircleCheck class="text-gain!" />{:else}<TriangleAlert />{/if}
          <Alert.Title>
            {current.totals.ok
              ? 'The file’s totals match its lines'
              : 'The file’s totals don’t match its lines'}
          </Alert.Title>
          <Alert.Description>
            Invested {inr(current.totals.file.invested)} vs {inr(current.totals.lines.invested)},
            value {inr(current.totals.file.value)} vs {inr(current.totals.lines.value)}.
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#each current.warnings as w (w)}
        <Alert.Root>
          <Info />
          <Alert.Description>{w}</Alert.Description>
        </Alert.Root>
      {/each}

      {#if current.confirm.length}
        <div class="grid gap-2">
          <h3 class="text-sm font-semibold">Check these fund matches</h3>
          <ul class="grid grid-cols-1 gap-2">
            {#each current.confirm as m (m.ref)}
              <li class="bg-muted/50 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl p-3">
                <span class="min-w-0 flex-1 text-sm">
                  {m.name}
                  <span class="text-muted-foreground block text-xs">→ {m.matched}</span>
                </span>
                <Button variant="link" size="sm" onclick={() => reject(m.ref)}>Not this fund</Button
                >
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#each current.findings.filter((f) => f.key === 'recon.unmatched') as f (f.message)}
        <p class="text-muted-foreground flex gap-2 text-sm">
          <TriangleAlert class="mt-0.5 size-4 shrink-0" />{f.message}
        </p>
      {/each}

      <div>
        <Button variant="link" size="sm" class="px-0" onclick={() => (showAll = !showAll)}
          >{showAll ? 'Hide' : 'Show'} the {changes.length} changes</Button
        >
        {#if showAll}
          <ul class="mt-2 grid max-h-96 gap-1 overflow-y-auto rounded-2xl border p-2">
            {#each changes as item (item.index)}
              <li>
                <label class="hover:bg-muted/50 flex items-start gap-3 rounded-xl p-2 text-sm">
                  <Checkbox
                    class="mt-0.5"
                    checked={!excluded.includes(item.index)}
                    onCheckedChange={() => toggle(item.index)}
                  />
                  <span class="min-w-0 flex-1">
                    {item.label}
                    <Badge variant="secondary" class="ml-1">{item.status}</Badge>
                    {#if item.mismatch}<span class="text-destructive block text-xs"
                        >{item.mismatch}</span
                      >{/if}
                  </span>
                </label>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="flex gap-2">
        <Button disabled={busy} onclick={confirm}>{busy ? 'Importing…' : 'Import'}</Button>
        <Button variant="ghost" onclick={onDone}>Cancel</Button>
      </div>
    {/if}
  </Card.Content>
</Card.Root>
