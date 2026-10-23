// SPDX-License-Identifier: MIT
import Root from './tabs.svelte';
import Content from './tabs-content.svelte';
import List, { type TabsListVariant, tabsListVariants } from './tabs-list.svelte';
import Trigger from './tabs-trigger.svelte';

export {
  Content,
  List,
  Root,
  //
  Root as Tabs,
  Content as TabsContent,
  List as TabsList,
  type TabsListVariant,
  tabsListVariants,
  Trigger as TabsTrigger,
  Trigger,
};
