// SPDX-License-Identifier: AGPL-3.0-only
// One "are you sure?" dialog for the whole app: `if (!(await ask({...}))) return;`
export type Ask = { title: string; description: string; action: string; destructive?: boolean };

export const dialog = $state({ open: false, ask: null as Ask | null });
let resolve: ((ok: boolean) => void) | undefined;

export function ask(question: Ask): Promise<boolean> {
  resolve?.(false);
  dialog.ask = question;
  dialog.open = true;
  return new Promise((r) => (resolve = r));
}

export function answer(ok: boolean): void {
  dialog.open = false;
  resolve?.(ok);
  resolve = undefined;
}
