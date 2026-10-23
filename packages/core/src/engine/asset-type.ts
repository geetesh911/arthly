// SPDX-License-Identifier: AGPL-3.0-only
import type { Instrument, InstrumentKind, Snapshot } from '../model/types.ts';
import type { ISODate } from '../util/dates.ts';
import type { Position } from './positions.ts';
import type { PriceBook } from './prices.ts';
import type { RateTables } from './rates.ts';

export interface AssetContext {
  date: ISODate;
  prices: PriceBook;
  rates: RateTables;
  /** Snapshots for a holding (by position key), sorted by date. */
  snapshots(key: string): Snapshot[];
}

export type HoldingStatus = 'open' | 'matured' | 'closed';

/** Values are in the instrument's currency. */
export interface Valuation {
  value: number;
  priceDate?: ISODate;
  /** No market price, a projected rate, or similar. */
  estimate: boolean;
  status: HoldingStatus;
  /** PPF, EPF: the balance a statement shows, without interest not credited yet. */
  balance?: number;
}

export type CashFlowKind = 'payout' | 'coupon' | 'maturity' | 'credit';

export interface CashFlow {
  date: ISODate;
  amount: number;
  kind: CashFlowKind;
  /** Worked out from terms or rates rather than recorded. */
  estimated: boolean;
}

export interface AssetType {
  id: string;
  kinds: InstrumentKind[];
  value(p: Position, i: Instrument, ctx: AssetContext): Valuation;
  invested(p: Position, i: Instrument): number;
  /** Payouts, coupons, credits and maturities due in (from, to]. */
  projected?(p: Position, i: Instrument, from: ISODate, to: ISODate, ctx: AssetContext): CashFlow[];
  /** Interest earned in (from, to], whether paid or not. */
  accrued?(p: Position, i: Instrument, from: ISODate, to: ISODate, ctx: AssetContext): number;
}
