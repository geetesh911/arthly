// SPDX-License-Identifier: AGPL-3.0-only
/** What was typed in a "Passphrase or recovery code" box, as the data worker takes it. */
export function typedSecret(text: string): { passphrase: string } | { recoveryCode: string } {
  return /^[A-Za-z2-7]{4}(-?[A-Za-z2-7]{4}){7}$/.test(text.trim())
    ? { recoveryCode: text }
    : { passphrase: text };
}
