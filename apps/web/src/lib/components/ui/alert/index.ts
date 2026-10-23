// SPDX-License-Identifier: MIT
import Root from './alert.svelte';
import Action from './alert-action.svelte';
import Description from './alert-description.svelte';
import Title from './alert-title.svelte';
export { type AlertVariant, alertVariants } from './alert.svelte';

export {
  Action,
  //
  Root as Alert,
  Action as AlertAction,
  Description as AlertDescription,
  Title as AlertTitle,
  Description,
  Root,
  Title,
};
