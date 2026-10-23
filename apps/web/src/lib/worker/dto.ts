// SPDX-License-Identifier: AGPL-3.0-only
// Plain data the worker sends to the screens.
import type {
  AllocationTargets,
  Analytics,
  AssetClass,
  Benchmarks,
  Check,
  EntityMap,
  EntityName,
  Entry,
  HoldingStatus,
  ISODate,
  LoanDirection,
  LoanEntry,
  Lot,
} from '@pv/core';

export interface AnalyticsDto extends Analytics {
  targets: AllocationTargets | null;
  /** NSE and BSE index levels; they don't depend on the filter. */
  indices: Benchmarks;
  reference: {
    nseDate?: string;
    nseStale: boolean;
    amfiSchemes: number;
    /** AMFI's cap list: the half-year it covers, when and where it was fetched, and its size. */
    caps?: { asOf: string; date: string; url: string; companies: number; stale: boolean };
    /** Why the latest attempt to refresh the cap list failed. */
    capsFailure?: string;
    /** Fund reports analytics can use, fetched and added. */
    fundReports: number;
    /** Scheme reports added by hand on this device, and the newest report's date. */
    addedReports: { schemes: number; newest?: string };
    /** Why the latest fund report refresh fell short, per AMC (`label` is its name). */
    fundFailures: { source: string; label: string; message: string }[];
  };
}

/** What adding a fund report by hand brought. */
export interface AddedFundReportDto {
  schemes: number;
  /** The newest portfolio date in the file. */
  asOf: string;
  /** Schemes in the file that couldn't be read. */
  skipped: string[];
  /** Held funds now using one of its reports. */
  funds: string[];
}

export interface VaultSummary {
  vaultId: string;
  name: string;
  created: string;
  passkeys: { credentialId: string; prfSalt: string; label: string }[];
}

export interface Filter {
  memberId?: string;
  groupId?: string;
  assetClass?: AssetClass;
}

export interface HoldingDto {
  key: string;
  accountId: string;
  accountLabel: string;
  memberId: string;
  memberName: string;
  instrumentId: string;
  name: string;
  kind: EntityMap['instrument']['kind'];
  assetClass: AssetClass;
  groups: string[];
  status: HoldingStatus;
  units: number | null;
  price: number | null;
  priceDate?: ISODate;
  value: number;
  invested: number;
  gain: number;
  gainPct: number | null;
  xirr: number | null;
  xirrEstimate: boolean;
  /** XIRR is the one the holdings file of this date gives. */
  xirrAsOf?: ISODate;
  estimate: boolean;
  weight: number;
  firstDate?: ISODate;
}

export interface UpcomingDto {
  date: ISODate;
  kind: string;
  name: string;
  amount?: number;
  estimated: boolean;
}

export interface Point {
  date: ISODate;
  value: number;
  netInvested: number;
  costOnly: boolean;
}

/** When prices were last fetched, and the newest fund and stock prices among them. */
export interface PriceStatusDto {
  fetched?: string;
  funds?: ISODate | undefined;
  stocks?: ISODate | undefined;
}

export interface OverviewDto {
  date: ISODate;
  /** Investments plus what you're owed, less what you owe. */
  netWorth: number;
  investments: number;
  owedToYou: number;
  youOwe: number;
  invested: number;
  netInvested: number;
  totalGain: number;
  xirr: number | null;
  xirrEstimate: boolean;
  absoluteReturn: number | null;
  firstFlow?: ISODate;
  allocation: {
    assetClass: [string, number][];
    member: [string, number][];
    group: [string, number][];
  };
  history: Point[];
  upcoming: UpcomingDto[];
  checks: Check[];
  holdings: number;
  /** Loans, open or settled. With none and no holdings, Home shows its welcome. */
  loans: number;
  pricesAsOf?: string;
  readOnly: boolean;
}

export interface HoldingDetailDto {
  holding: HoldingDto;
  entries: Entry[];
  lots: Lot[];
  history: Point[];
}

export interface PlanItemDto {
  index: number;
  entity: EntityName;
  label: string;
  status: 'new' | 'changed' | 'same' | 'duplicate';
  include: boolean;
  mismatch?: string;
}

export interface PlanDto {
  planId: string;
  importer: string;
  fileName: string;
  asOf?: string;
  memberId: string;
  items: PlanItemDto[];
  confirm: { ref: string; name: string; matched: string; score: number }[];
  totals?: {
    file: { invested?: number; value?: number };
    lines: { invested: number; value: number };
    ok: boolean;
  };
  findings: { key: string; message: string }[];
  warnings: string[];
  upToDate: boolean;
}

export type PrepareResult =
  { kind: 'plan'; plan: PlanDto } | { kind: 'unknown'; headings: string[] };

export interface AccountDto {
  id: string;
  memberId: string;
  /** The member's name. */
  member: string;
  label: string;
  institution: string;
  transactions: number;
  /** Statement balances (snapshots). */
  balances: number;
}

export interface BatchDto {
  batchId: string;
  importer: string;
  fileName: string;
  date: string;
  asOf?: string;
  records: number;
  reverted: boolean;
  kept: number;
}

export interface UnlockMethodDto {
  id: string;
  type: 'passphrase' | 'recovery' | 'passkey';
  label?: string;
  updated: string;
}

export interface FileOut {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface LoanDto {
  id: string;
  memberId: string;
  memberName: string;
  direction: LoanDirection;
  party: string;
  due?: ISODate;
  note?: string;
  advanced: number;
  repaid: number;
  writtenOff: number;
  /** Below zero when more was paid back than lent. */
  balance: number;
  open: boolean;
  overdue: boolean;
  start?: ISODate;
  settled?: ISODate;
}

export interface LoansDto {
  date: ISODate;
  owedToYou: number;
  youOwe: number;
  /** Open ones first, by balance; then settled ones, latest first. */
  loans: LoanDto[];
}

export interface LoanDetailDto {
  loan: LoanDto;
  entries: LoanEntry[];
}

export interface NewLoanInput {
  memberId: string;
  direction: LoanDirection;
  party: string;
  amount: number;
  date: ISODate;
  due?: ISODate;
  note?: string;
}
