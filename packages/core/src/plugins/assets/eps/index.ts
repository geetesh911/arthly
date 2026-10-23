// SPDX-License-Identifier: AGPL-3.0-only
// EPS: pension money that earns no interest; valued at the sum of contributions.
import type { AssetType } from '../../../engine/asset-type.ts';

export const eps: AssetType = {
  id: 'eps',
  kinds: ['eps'],
  value: (p) => ({
    value: p.principal,
    estimate: false,
    status: p.principal > 0 ? 'open' : 'closed',
  }),
  invested: (p) => p.principal,
};
