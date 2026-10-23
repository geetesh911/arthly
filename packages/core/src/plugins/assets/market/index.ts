// SPDX-License-Identifier: AGPL-3.0-only
// Stocks, ETFs, mutual funds and US stocks: units × price.
import type { AssetType } from '../../../engine/asset-type.ts';

export const market: AssetType = {
  id: 'market',
  kinds: ['stock', 'etf', 'mf', 'us-stock', 'other'],
  value(p, i, ctx) {
    const status = p.units > 1e-9 ? 'open' : 'closed';
    const price = ctx.prices.price(i, ctx.date);

    if (price) {
      return { value: p.units * price.price, priceDate: price.date, estimate: false, status };
    }

    return { value: p.cost, estimate: true, status };
  },
  invested: (p) => p.cost,
};
