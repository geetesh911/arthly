<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Check } from '@pv/core';

  import { api } from '#lib/api.ts';
  import { app } from '#lib/app.svelte.ts';
  import CheckList from '#lib/components/CheckList.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import * as Card from '#lib/components/ui/card/index.ts';

  let checks = $state<Check[] | null>(null);
  $effect(() => {
    void app.version;
    void api()
      .checks()
      .then((c) => (checks = c));
  });
</script>

<PageHeader
  title="Checks"
  back={{ href: '#/more', label: 'More' }}
  backClass="lg:hidden"
  description="Things in your data that may need a look: stale balances, mismatches, missing prices."
/>
<Card.Root>
  <Card.Content>
    {#if checks}<CheckList {checks} />{:else}<p class="text-muted-foreground text-sm">
        Checking…
      </p>{/if}
  </Card.Content>
</Card.Root>
