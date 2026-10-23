// SPDX-License-Identifier: AGPL-3.0-only
import type { AssetClass } from '../../../model/types.ts';

export type FundSourceId =
  | 'ppfas'
  | 'nippon'
  | 'hdfc'
  | 'sbi'
  | 'tata'
  | 'dsp'
  | 'boi'
  | 'zerodha'
  | 'quant'
  | 'invesco'
  | 'canara'
  | 'mirae';

export interface FundConstituent {
  name: string;
  isin?: string;
  /** Fraction of net assets: 0.08 means 8%; may be negative for cash liabilities. */
  weight: number;
  kind: 'stock' | 'debt' | 'cash' | 'commodity' | 'fund' | 'other';
  assetClass: AssetClass;
  industry?: string;
  amfi?: string;
}

export interface FundPortfolio {
  id: string;
  schemeName: string;
  /** 'file' for a report someone added by hand, which has no source URL. */
  source: FundSourceId | 'file';
  sourceUrl: string;
  asOf: string;
  amfiCodes?: string[];
  schemeIsins?: string[];
  constituents: FundConstituent[];
  /** Physical assets plus cash/receivables, before any rounding adjustment. */
  reportedWeight: number;
  /** A separately reported derivatives table exists; stock views show physical ownership. */
  derivatives: boolean;
  warnings: string[];
}

export interface FundHoldingsFile {
  version: 1;
  /** Retrieval date; portfolio asOf dates are retained independently. */
  date: string;
  portfolios: FundPortfolio[];
  /** Ids of portfolios kept from an earlier refresh, because this one didn't bring them. */
  retained?: string[];
  failures: { source: string; message: string }[];
}

export interface FundDisclosureFile {
  source: FundSourceId;
  url: string;
  name: string;
}

/** A workbook to read: a fetched disclosure, or a file added by hand with no URL. */
export type FundReportFile = Omit<FundDisclosureFile, 'source'> & {
  source: FundPortfolio['source'];
};

export interface FundDisclosureIndex {
  version: 1;
  date: string;
  files: FundDisclosureFile[];
  failures: { source: string; message: string }[];
}
