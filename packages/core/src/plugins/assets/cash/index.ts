// SPDX-License-Identifier: AGPL-3.0-only
// Bank cash: the latest balance snapshot.
import type { AssetType } from '../../../engine/asset-type.ts';

export const cash: AssetType = {
  id: 'cash',
  kinds: ['cash'],
  value(p, _i, ctx) {
    const latest = ctx
      .snapshots(p.key)
      .filter((s) => s.asOf <= ctx.date)
      .at(-1);
    const value = latest ? (latest.value ?? latest.units) : p.units || p.principal;
    return {
      value,
      estimate: false,
      status: value > 0 ? 'open' : 'closed',
      ...(latest ? { priceDate: latest.asOf } : {}),
    };
  },
  invested(p) {
    return p.units || p.principal;
  },
};
