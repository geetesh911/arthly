<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import BondVsFd from '#lib/components/BondVsFd.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
</script>

<PageHeader
  title="Bond or FD"
  description="A bond’s yield to maturity, and how it compares with a fixed deposit after tax."
  back={{ href: '#/tools', label: 'Tools' }}
/>
<BondVsFd />
