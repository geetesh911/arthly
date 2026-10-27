// SPDX-License-Identifier: AGPL-3.0-only
import type { Importer } from '../../import/types.ts';

import { bobPpfStatement } from './bob-ppf-statement/index.ts';
import { epfoPassbook } from './epfo-passbook/index.ts';
import { growwMfHoldings } from './groww-mf-holdings/index.ts';
import { growwMfOrders } from './groww-mf-orders/index.ts';
import { growwStockHoldings } from './groww-stock-holdings/index.ts';
import { growwStockOrders } from './groww-stock-orders/index.ts';
import { template } from './template/index.ts';

/** Every built-in importer. Adding one is a folder plus a line here. */
export const importers: Importer[] = [
  growwMfHoldings,
  growwStockHoldings,
  growwMfOrders,
  growwStockOrders,
  bobPpfStatement,
  epfoPassbook,
  template,
];
