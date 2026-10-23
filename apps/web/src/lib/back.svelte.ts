// SPDX-License-Identifier: AGPL-3.0-only
import { afterNavigate } from '$app/navigation';

/**
 * A form's back link: the screen it was opened from (Add opens forms from anywhere), or
 * `fallback` when the app opened on the form itself. Call it while the page sets up.
 */
export function backLink(fallback: { href: string; label: string }) {
  let link = $state(fallback);

  afterNavigate(({ from }) => {
    if (from) {
      link = { href: from.url.hash || '#/', label: 'Back' };
    }
  });

  return {
    get current() {
      return link;
    },
  };
}
