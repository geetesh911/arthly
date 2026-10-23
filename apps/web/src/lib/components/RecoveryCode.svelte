<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';

  import { Button } from '#lib/components/ui/button/index.ts';

  let { code }: { code: string } = $props();
  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="bg-muted flex items-center gap-3 rounded-2xl p-4">
  <p
    class="flex-1 font-mono text-base tracking-wider break-all sm:text-lg"
    data-testid="recovery-code"
  >
    {code}
  </p>
  <Button variant="outline" size="sm" onclick={copy}>
    {#if copied}<Check />Copied{:else}<Copy />Copy{/if}
  </Button>
</div>
