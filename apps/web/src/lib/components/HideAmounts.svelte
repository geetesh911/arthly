<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- The eye that hides every amount in the app as ₹••••, and shows them again. -->
<script lang="ts">
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';

  import { amountsHidden, hideAmounts } from '#lib/amounts.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { cn } from '#lib/utils.ts';

  let { class: className }: { class?: string | undefined } = $props();
  const hidden = $derived(amountsHidden());
</script>

<Button
  variant="ghost"
  size="icon"
  aria-pressed={hidden}
  title={hidden ? 'Show amounts' : 'Hide amounts'}
  onclick={() => hideAmounts(!hidden)}
  class={cn('text-muted-foreground shrink-0 rounded-full', className)}
>
  {#if hidden}<EyeOff class="size-5" />{:else}<Eye class="size-5" />{/if}
  <span class="sr-only">Hide amounts</span>
</Button>
