// SPDX-License-Identifier: AGPL-3.0-only
import type { Price } from '../../engine/prices.ts';
import type { Instrument } from '../../model/types.ts';
import type { ISODate } from '../../util/dates.ts';

export interface PriceContext {
  fetch: typeof fetch;
  /** The user's API key, for sources that need one. */
  key?: string;
}

export interface PriceSource {
  id: string;
  label: string;
  /** Origins the source talks to; they feed the CSP connect-src. */
  origins: string[];
  needsKey?: boolean;
  covers(i: Instrument): boolean;
  latest(list: Instrument[], ctx: PriceContext): Promise<Price[]>;
  history?(list: Instrument[], from: ISODate, to: ISODate, ctx: PriceContext): Promise<Price[]>;
}
