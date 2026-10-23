// SPDX-License-Identifier: AGPL-3.0-only
// The app's sections: the phone tab bar and the desktop sidebar each show their own subset.
import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';
import ChartPie from '@lucide/svelte/icons/chart-pie';
import CirclePlus from '@lucide/svelte/icons/circle-plus';
import Ellipsis from '@lucide/svelte/icons/ellipsis';
import House from '@lucide/svelte/icons/house';
import IndianRupee from '@lucide/svelte/icons/indian-rupee';
import Settings from '@lucide/svelte/icons/settings';
import ShieldCheck from '@lucide/svelte/icons/shield-check';

export type Section = {
  href: string;
  label: string;
  icon: typeof House;
  match: (route: string) => boolean;
  phone: boolean;
  desktop: boolean;
};

const starts =
  (...prefixes: string[]) =>
  (route: string) =>
    prefixes.some((p) => route.startsWith(p));

export const sections: Section[] = [
  { href: '#/', label: 'Home', icon: House, match: (r) => r === '/', phone: true, desktop: true },
  {
    href: '#/holdings',
    label: 'Holdings',
    icon: ChartPie,
    match: starts('/holdings'),
    phone: true,
    desktop: true,
  },
  {
    href: '#/analytics',
    label: 'Analytics',
    icon: ChartNoAxesCombined,
    match: starts('/analytics'),
    phone: false,
    desktop: true,
  },
  {
    href: '#/add',
    label: 'Add',
    icon: CirclePlus,
    match: starts('/add'),
    phone: true,
    desktop: true,
  },
  {
    href: '#/checks',
    label: 'Checks',
    icon: ShieldCheck,
    match: starts('/checks'),
    phone: true,
    desktop: true,
  },
  {
    href: '#/income',
    label: 'Income',
    icon: IndianRupee,
    match: starts('/income'),
    phone: false,
    desktop: true,
  },
  {
    href: '#/more',
    label: 'More',
    icon: Ellipsis,
    match: starts('/more', '/income', '/settings', '/analytics'),
    phone: true,
    desktop: false,
  },
  {
    href: '#/settings',
    label: 'Settings',
    icon: Settings,
    match: starts('/settings', '/more'),
    phone: false,
    desktop: true,
  },
];
