<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- An Add button whose menu links to each form, grouped by area. -->
<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';

  import { type ButtonSize, buttonVariants } from '#lib/components/ui/button/index.ts';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
  import { cn } from '#lib/utils.ts';

  import type { AddGroup } from './Nav.ts';

  let {
    groups,
    size = 'default',
    align = 'start',
    class: className,
  }: {
    groups: AddGroup[];
    size?: ButtonSize;
    align?: 'start' | 'end';
    class?: string;
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class={cn(buttonVariants({ size }), className)}
    ><Plus />Add</DropdownMenu.Trigger
  >
  <DropdownMenu.Content {align} class="w-56">
    {#each groups as group, i (group.label ?? i)}
      {#if i > 0}<DropdownMenu.Separator />{/if}
      <DropdownMenu.Group>
        {#if group.label}<DropdownMenu.GroupHeading>{group.label}</DropdownMenu.GroupHeading>{/if}
        {#each group.links as link (link.href)}
          <DropdownMenu.Item>
            {#snippet child({ props })}
              <a href={link.href} {...props}><link.icon class="text-brand" />{link.label}</a>
            {/snippet}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Group>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
