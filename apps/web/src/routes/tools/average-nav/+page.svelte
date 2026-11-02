<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import AverageNav from '#lib/components/AverageNav.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
</script>

<PageHeader
  title="Average NAV"
  description="What buying more of a fund does to your average NAV, in units or as an amount."
  back={{ href: '#/tools', label: 'Tools' }}
/>
<AverageNav />
