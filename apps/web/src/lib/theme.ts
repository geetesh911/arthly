// SPDX-License-Identifier: AGPL-3.0-only
// Light, dark, or follow the device. A display preference, kept per device; no financial data.
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'theme';

export function readTheme(storage: Pick<Storage, 'getItem'> = localStorage): Theme {
  try {
    const value = storage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** System needs no class: app.css follows prefers-color-scheme. */
export function applyTheme(root: { classList: DOMTokenList }, theme: Theme): void {
  root.classList.remove('light', 'dark');
  if (theme !== 'system') root.classList.add(theme);
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  applyTheme(document.documentElement, theme);
}
