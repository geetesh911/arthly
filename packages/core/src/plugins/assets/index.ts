// SPDX-License-Identifier: AGPL-3.0-only
import type { AssetType } from '../../engine/asset-type.ts';
import type { InstrumentKind } from '../../model/types.ts';

import { bond } from './bond/index.ts';
import { cash } from './cash/index.ts';
import { deposit } from './deposit/index.ts';
import { epf } from './epf/index.ts';
import { eps } from './eps/index.ts';
import { market } from './market/index.ts';
import { ppf } from './ppf/index.ts';

export const assetTypes: AssetType[] = [market, deposit, bond, ppf, epf, eps, cash];

export function assetTypeFor(kind: InstrumentKind): AssetType {
  return assetTypes.find((a) => a.kinds.includes(kind)) ?? market;
}
