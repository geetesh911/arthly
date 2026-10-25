// SPDX-License-Identifier: AGPL-3.0-only
// What every screen shares: whether the vault is open, the member filter, and a message line.
import { on } from 'svelte/events';

import type { CloudStatusDto, Filter } from './worker/dto.ts';
import { api, list, proxy } from './api.ts';
import { takeGoogleRedirect } from './google.ts';

type Status = 'loading' | 'locked' | 'open';

export const app = $state({
  status: 'loading' as Status,
  vault: null as null | { vaultId: string; name: string; demo: boolean; readOnly: boolean },
  filter: {} as Filter,
  /** Bumped after every change, so screens reload. */
  version: 0,
  message: '' as string,
  members: [] as { id: string; name: string }[],
  /** Cloud sync for the open portfolio, as the data worker last reported it. */
  sync: null as CloudStatusDto | null,
});

let lastTouch = 0;

export async function start(): Promise<void> {
  await api().listenForLock(
    proxy((reason?: string) => {
      app.status = 'locked';
      app.vault = null;
      app.sync = null;

      if (reason) {
        say(reason);
      }
    }),
  );
  await api().listenForSync(
    proxy((status: CloudStatusDto, pulled: boolean) => {
      app.sync = status;

      // Changes from another device: the screens reload.
      if (pulled) {
        void changed();
      }
    }),
  );
  await opened();
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.status === 'open') {
      void api().syncIfStale();
    }
  });

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
    app.sync = await api().cloudStatus();
    app.version += 1;
    void finishConnecting();
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
  app.sync = null;
}

/** Connects Google Drive with a sign-in that came back after a full-page redirect and an unlock. */
async function finishConnecting(): Promise<void> {
  const grant = takeGoogleRedirect('connect', app.vault?.vaultId);

  if (!grant) {
    return;
  }

  const status = await attempt(() => api().connectGoogle(grant));

  if (status) {
    app.sync = status;
    say('Google Drive is connected.');
  }
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
