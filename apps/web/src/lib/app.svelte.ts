// SPDX-License-Identifier: AGPL-3.0-only
// What every screen shares: whether the vault is open, the member filter, and a message line.
import { on } from 'svelte/events';

import type { Filter } from './worker/dto.ts';
import { api, list, proxy } from './api.ts';

type Status = 'loading' | 'locked' | 'open';

export const app = $state({
  status: 'loading' as Status,
  vault: null as null | { vaultId: string; name: string; demo: boolean; readOnly: boolean },
  filter: {} as Filter,
  /** Bumped after every change, so screens reload. */
  version: 0,
  message: '' as string,
  members: [] as { id: string; name: string }[],
});

let lastTouch = 0;

export async function start(): Promise<void> {
  await api().listenForLock(
    proxy(() => {
      app.status = 'locked';
      app.vault = null;
    }),
  );
  await opened();

  for (const event of ['pointerdown', 'keydown']) {
    on(window, event, () => {
      if (app.status !== 'open' || Date.now() - lastTouch < 15_000) {
        return;
      }

      lastTouch = Date.now();
      void api().touch();
    });
  }
}

/** Reads the open vault from the worker, after unlocking or creating one. */
export async function opened(): Promise<void> {
  app.vault = await api().current();
  app.status = app.vault ? 'open' : 'locked';

  if (app.vault) {
    app.members = (await list('member')).map((m) => ({ id: m.id, name: m.name }));
    app.version += 1;
    void api()
      .refreshPrices()
      .then((r) => {
        if (!r.ok && r.message) {
          say(r.message);
        }

        app.version += 1;
      });
  }
}

export async function lock(): Promise<void> {
  await api().lock();
  app.status = 'locked';
  app.vault = null;
}

export async function changed(): Promise<void> {
  app.members = (await list('member')).map((m) => ({ id: m.id, name: m.name }));

  if (app.filter.memberId && !app.members.some((m) => m.id === app.filter.memberId)) {
    delete app.filter.memberId;
  }

  app.version += 1;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export function say(message: string): void {
  app.message = message;
  clearTimeout(timer);
  timer = setTimeout(() => (app.message = ''), 6000);
}

/**
 * Runs an action and shows its error, if any, in the message line. Gives undefined on error.
 * An action that returns nothing gives true, so its success can be told apart.
 */
export async function attempt<T>(
  action: () => Promise<T>,
): Promise<(T extends void ? true : T) | undefined> {
  try {
    const value = await action();

    return (value === undefined ? true : value) as T extends void ? true : T;
  } catch (error) {
    say((error as Error).message.replace(/^.*Error: /, ''));

    return undefined;
  }
}
