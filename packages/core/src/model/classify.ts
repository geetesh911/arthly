// SPDX-License-Identifier: AGPL-3.0-only
import type { AssetClass, InstrumentKind } from './types.ts';

/** The asset class an instrument gets unless the user says otherwise. */
export function defaultAssetClass(kind: InstrumentKind, name: string, category = ''): AssetClass {
  const words = `${name} ${category}`.toLowerCase();

  switch (kind) {
    case 'fd':
    case 'ppf':
    case 'epf':
    case 'eps':
    case 'bond':
      return 'debt';

    case 'sgb':
      return 'gold';

    case 'cash':
      return 'cash';
  }

  // Fund names run words together (GOLDCASE, NETFSILVER), so no word boundaries here.
  if (/gold(?!man)/.test(words)) {
    return 'gold';
  }

  if (/silver/.test(words)) {
    return 'silver';
  }

  if (/\bliquid|overnight|money market/.test(words)) {
    return 'cash';
  }

  if (kind === 'mf') {
    if (/hybrid|balanced|arbitrage|asset allocation|multi asset|equity savings/.test(words)) {
      return 'hybrid';
    }

    if (
      /\bdebt|gilt|bond|corporate|credit risk|duration|banking and psu|banking & psu|floater|sdl|g-sec|income/.test(
        words,
      )
    ) {
      return 'debt';
    }
  }

  return 'equity';
}
