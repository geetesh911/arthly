<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Arthly's mark, in the text colour. `tile` sets it in lime on an ink square, which reads in both
     themes; lime alone is too light for a light page. -->
<script lang="ts">
  import { cn } from '#lib/utils.ts';

  let { class: className = '', tile = false }: { class?: string; tile?: boolean } = $props();
</script>

{#snippet mark(className: string)}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 897 788"
    fill="currentColor"
    aria-hidden="true"
    class={className}
  >
    <path
      d="M408.3 1l73.7-0.5l12 1.2l10 3l7 3.2l11.6 8.1l7 7l7.8 11l3.9 7l74.4 148l86.4 167l8.1 17l-153.2 64.4l-12 4.3l-12.3-26.7l-84.7-194.6l-5.3 10.6l-29.4 68l-99.7 225l-292.6 170.5l-0.3-1.5l14-28l179.6-346l145.5-285l10.2-13.9l10-8.4l8-4.7l7-3.1zM720 395l1-0.6l1.1 0.6l13.3 25l142.1 274l14.7 30l4.2 17l0.1 8l-1.1 8l-2 6l-4.1 7l-8.3 8.3l-6 3.8l-11 4l-12 1.5h-133l-9-0.3l-5-1l-9-3.1l-5-2.8l-10-8.5l-4.2-4.9l-2.8-5l-73.8-167l-4.2-6.1l-3-1.3l-5-0.3l-282 0.3l-4.3 2.4l-4 7l-73.7 163.9l-7.9 11.1l-11.1 9.2l-12 5l-11 1.5l-140-0.2l-12-2.2l-11-5l-6-4.6l-7.4-8.7l-4.6-13l-0.4-10l3.2-15l5.2-11.2l311-139.5z"
    />
  </svg>
{/snippet}

{#if tile}
  <span
    class={cn(
      'bg-foreground dark:bg-muted grid shrink-0 place-items-center rounded-[30%]',
      className,
    )}>{@render mark('text-brand w-[56%]')}</span
  >
{:else}
  {@render mark(className)}
{/if}
