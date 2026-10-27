// SPDX-License-Identifier: AGPL-3.0-only
// The app's sections: the phone tab bar and the desktop sidebar each show their own subset.
// Add isn't one: it's a button on both that opens the list of forms below.
import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
import Calculator from '@lucide/svelte/icons/calculator';
import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';
import ChartPie from '@lucide/svelte/icons/chart-pie';
import CreditCard from '@lucide/svelte/icons/credit-card';
import Ellipsis from '@lucide/svelte/icons/ellipsis';
import FileUp from '@lucide/svelte/icons/file-up';
import HandCoins from '@lucide/svelte/icons/hand-coins';
import House from '@lucide/svelte/icons/house';
import IndianRupee from '@lucide/svelte/icons/indian-rupee';
import Landmark from '@lucide/svelte/icons/landmark';
import PiggyBank from '@lucide/svelte/icons/piggy-bank';
import ReceiptText from '@lucide/svelte/icons/receipt-text';
import Settings from '@lucide/svelte/icons/settings';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import Tag from '@lucide/svelte/icons/tag';
import Target from '@lucide/svelte/icons/target';

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
    href: '#/loans',
    label: 'Loans',
    icon: HandCoins,
    match: starts('/loans'),
    phone: false,
    desktop: true,
  },
  {
    href: '#/cards',
    label: 'Cards',
    icon: CreditCard,
    match: starts('/cards'),
    phone: false,
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
    href: '#/plan',
    label: 'Plan',
    icon: Target,
    match: starts('/plan'),
    phone: false,
    desktop: true,
  },
  {
    href: '#/tools',
    label: 'Tools',
    icon: Calculator,
    match: starts('/tools'),
    phone: false,
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
    match: starts(
      '/more',
      '/income',
      '/settings',
      '/analytics',
      '/plan',
      '/tools',
      '/loans',
      '/cards',
    ),
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

export type AddLink = { href: string; label: string; icon: typeof House };

export type AddGroup = { label?: string; links: AddLink[] };

export const importFiles: AddLink = { href: '#/import', label: 'Import files', icon: FileUp };

export const addInvestment: AddGroup = {
  label: 'Investments',
  links: [
    { href: '#/holdings/add/transaction', label: 'Transaction', icon: ArrowLeftRight },
    { href: '#/holdings/add/fd', label: 'FD, bond or SGB', icon: Landmark },
    { href: '#/holdings/add/balance', label: 'PPF, EPF or cash', icon: PiggyBank },
    { href: '#/holdings/add/price', label: 'Price', icon: Tag },
  ],
};

/** What the Add button offers: files first, then each area's own forms. */
export const addGroups: AddGroup[] = [
  { links: [importFiles] },
  addInvestment,
  { label: 'Loans', links: [{ href: '#/loans/new', label: 'Loan', icon: HandCoins }] },
  {
    label: 'Cards',
    links: [
      { href: '#/cards/new', label: 'Card', icon: CreditCard },
      { href: '#/cards/bill', label: 'Card bill', icon: ReceiptText },
    ],
  },
];
