<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { type Instrument, randomId } from '@pv/core';

  import { api, list } from '#lib/api.ts';
  import { attempt, changed, say } from '#lib/app.svelte.ts';
  import FormField from '#lib/components/FormField.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { NativeSelect } from '#lib/components/ui/native-select/index.ts';
  import { todayIso } from '#lib/forms.ts';

  let instruments = $state<Instrument[]>([]);
  let instrumentId = $state('');
  let date = $state(todayIso());
  let price = $state('');

  onMount(async () => {
    instruments = (await list('instrument')).filter(
      (i) => !['fd', 'ppf', 'epf', 'eps', 'cash'].includes(i.kind),
    );
    const ref = new URLSearchParams(location.hash.split('?')[1] ?? '').get('ref');

    if (ref) {
      instrumentId = ref;
    }
  });

  async function save(event: Event) {
    event.preventDefault();
    const value = { id: randomId('mp'), instrumentId, date, price: Number(price) };

    if ((await attempt(() => api().save('manualPrice', value))) !== undefined) {
      say('Price saved');
      price = '';
      await changed();
    }
  }
</script>

<PageHeader
  title="Set a price"
  back={{ href: '#/add', label: 'Add' }}
  description="For US stocks, unlisted bonds, or anything the price feed doesn't cover. A price you set wins until the feed has a newer one. US prices are in USD."
/>
<Card.Root class="max-w-2xl">
  <Card.Content>
    <form class="grid gap-4" onsubmit={save}>
      <FormField label="Holding">
        <NativeSelect bind:value={instrumentId} required class="w-full">
          <option value="" disabled>Choose…</option>
          {#each instruments as i (i.id)}<option value={i.id}>{i.name}</option>{/each}
        </NativeSelect>
      </FormField>
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField label="Date"><Input type="date" bind:value={date} required /></FormField>
        <FormField label="Price per unit">
          <Input inputmode="decimal" bind:value={price} required />
        </FormField>
      </div>
      <Button type="submit" class="sm:justify-self-start">Save</Button>
    </form>
  </Card.Content>
</Card.Root>
