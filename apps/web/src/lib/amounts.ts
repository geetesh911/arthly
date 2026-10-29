// SPDX-License-Identifier: AGPL-3.0-only
// Whether amounts show as ₹••••, for opening the app with people around. A display preference,
// kept per device; no financial data.
import { createSubscriber } from 'svelte/reactivity';

const KEY = 'hide-amounts';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'yes';
  } catch {
    return false;
  }
}

let hidden = read();

let changed = () => {};

const subscribe = createSubscriber((update) => {
  changed = update;

  return () => (changed = () => {});
});

/** Read on a screen, it updates the screen when amounts are hidden or shown. */
export function amountsHidden(): boolean {
  subscribe();

  return hidden;
}

export function hideAmounts(value: boolean): void {
  hidden = value;

  try {
    if (value) {
      localStorage.setItem(KEY, 'yes');
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }

  changed();
}
