<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { answer, dialog } from '#lib/confirm.svelte.ts';
</script>

<AlertDialog.Root
  open={dialog.open}
  onOpenChange={(open) => {
    if (!open) answer(false);
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{dialog.ask?.title}</AlertDialog.Title>
      <AlertDialog.Description>{dialog.ask?.description}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={() => answer(false)}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        variant={dialog.ask?.destructive ? 'destructive' : 'default'}
        onclick={() => answer(true)}>{dialog.ask?.action}</AlertDialog.Action
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
