<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- A card bill's four fields, as the bank's app or SMS gives them. -->
<script lang="ts">
  import FormField from '#lib/components/FormField.svelte';
  import { Input } from '#lib/components/ui/input/index.ts';

  let {
    amount = $bindable(''),
    minimumDue = $bindable(''),
    statementDate = $bindable(''),
    dueDate = $bindable(''),
    required = true,
  }: {
    amount?: string;
    minimumDue?: string;
    statementDate?: string;
    dueDate?: string;
    required?: boolean;
  } = $props();
</script>

<div class="grid gap-4 sm:grid-cols-2">
  <FormField label="Bill amount (₹)" hint="The total due. 0 for a month with no spends.">
    <Input inputmode="decimal" bind:value={amount} {required} />
  </FormField>
  <FormField label="Minimum due (₹)">
    <Input inputmode="decimal" bind:value={minimumDue} {required} />
  </FormField>
</div>
<div class="grid gap-4 sm:grid-cols-2">
  <FormField label="Statement date">
    <Input type="date" bind:value={statementDate} {required} />
  </FormField>
  <FormField label="Due date"><Input type="date" bind:value={dueDate} {required} /></FormField>
</div>
