// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { applyTheme, readTheme } from './theme.ts';

function root() {
  const set = new Set<string>();
  const classList = {
    add: (...c: string[]) => c.forEach((x) => set.add(x)),
    remove: (...c: string[]) => c.forEach((x) => set.delete(x)),
  } as unknown as DOMTokenList;

  return { classList, set };
}

describe('theme', () => {
  it('puts only the chosen class on the root, and none for system', () => {
    const r = root();

    applyTheme(r, 'dark');
    expect([...r.set]).toEqual(['dark']);
    applyTheme(r, 'light');
    expect([...r.set]).toEqual(['light']);
    applyTheme(r, 'system');
    expect([...r.set]).toEqual([]);
  });

  it('reads a stored choice and falls back to system', () => {
    expect(readTheme({ getItem: () => 'dark' })).toBe('dark');
    expect(readTheme({ getItem: () => 'purple' })).toBe('system');
    expect(readTheme({ getItem: () => null })).toBe('system');
    expect(
      readTheme({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('system');
  });
});
