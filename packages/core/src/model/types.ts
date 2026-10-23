// SPDX-License-Identifier: AGPL-3.0-only
import type { ISODate } from '../util/dates.ts';

export type { ISODate };
export type Currency = 'INR' | 'USD';

export interface Member {
  id: string;
  name: string;
}

export type AccountKind = 'demat' | 'mf' | 'bank' | 'ppf' | 'epf' | 'other';

export interface Account {
  id: string;
  memberId: string;
  institution: string;
  kind: AccountKind;
  label: string;
  /** Masked: only the last 4 characters are kept. */
  ref?: string;
  currency: Currency;
}

export type InstrumentKind =
  | 'stock'
  | 'etf'
  | 'mf'
  | 'sgb'
  | 'bond'
  | 'fd'
  | 'ppf'
  | 'epf'
  | 'eps'
  | 'cash'
  | 'us-stock'
  | 'other';

export type AssetClass = 'equity' | 'debt' | 'hybrid' | 'gold' | 'silver' | 'cash' | 'other';

export interface InstrumentIds {
  isin?: string;
  amfi?: string;
  nse?: string;
  bse?: string;
  us?: string;
}

export type Compounding = 'none' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';
export type Payout = 'cumulative' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';

export interface DepositTerms {
  principal: number;
  start: ISODate;
  maturity: ISODate;
  ratePct: number;
  compounding: Compounding;
  payout: Payout;
}

/** SGB: faceValue = issue price, couponPct 2.5, couponFreq 2, 8-year term. */
export interface BondTerms {
  faceValue: number;
  couponPct: number;
  couponFreq: 1 | 2 | 4 | 12;
  issue: ISODate;
  maturity: ISODate;
}

/** PPF: the date the account was opened, which sets the 15-year maturity. */
export interface PpfTerms {
  opened: ISODate;
}

export interface Instrument {
  id: string;
  kind: InstrumentKind;
  name: string;
  currency: Currency;
  assetClass: AssetClass;
  ids: InstrumentIds;
  terms?: DepositTerms | BondTerms | PpfTerms;
}

export type TransactionType =
  | 'opening'
  | 'buy'
  | 'sell'
  | 'switch-in'
  | 'switch-out'
  | 'dividend'
  | 'dividend-reinvest'
  | 'interest'
  | 'contribution'
  | 'withdrawal'
  | 'maturity'
  | 'bonus'
  | 'split'
  | 'charge'
  | 'tax';

export type Source = { kind: 'import'; batchId: string } | { kind: 'manual' };

export interface Transaction {
  id: string;
  accountId: string;
  instrumentId: string;
  date: ISODate;
  type: TransactionType;
  units?: number;
  price?: number;
  /** Always positive, in `currency`. The type gives the direction. */
  amount: number;
  currency: Currency;
  /** INR per unit of `currency`, when known. */
  fx?: number;
  meta?: Record<string, string>;
  source: Source;
}

export interface Snapshot {
  id: string;
  accountId: string;
  instrumentId: string;
  asOf: ISODate;
  units: number;
  invested?: number;
  value?: number;
  price?: number;
  /** The yearly return the holdings file itself gives, as a fraction (Groww's fund XIRR). */
  xirr?: number;
  source: Source;
}

export interface Group {
  id: string;
  name: string;
  holdings: { accountId?: string; instrumentId: string }[];
}

export interface ManualPrice {
  id: string;
  instrumentId: string;
  date: ISODate;
  price: number;
}

/** "Not a problem" on a check. */
export interface Dismissal {
  id: string;
  checkKey: string;
}

export interface Setting {
  /** The setting's key. */
  id: string;
  value: unknown;
}

/** They owe you (lent), or you owe them (borrowed). */
export type LoanDirection = 'lent' | 'borrowed';

export interface Loan {
  id: string;
  memberId: string;
  direction: LoanDirection;
  /** Who: the person or party. */
  party: string;
  /** When it should be paid back by. */
  due?: ISODate;
  note?: string;
}

/** `advance` is money handed over, lent or borrowed. */
export type LoanEntryType = 'advance' | 'repayment' | 'write-off';

export interface LoanEntry {
  id: string;
  loanId: string;
  date: ISODate;
  type: LoanEntryType;
  /** Always positive, in INR. The type gives the direction. */
  amount: number;
}

/** A credit card. No card number is kept, not even the last four digits. */
export interface Card {
  id: string;
  memberId: string;
  /** Who issued it. */
  bank: string;
  /** What you call it, such as "Travel card". */
  name: string;
  /** The credit limit, in INR. */
  limit?: number;
  /** The date you closed it. */
  closed?: ISODate;
}

export interface CardBill {
  id: string;
  cardId: string;
  statementDate: ISODate;
  dueDate: ISODate;
  /** The total due, in INR. Zero or more. */
  amount: number;
  minimumDue: number;
}

/** Not tied to a bill: it counts against the latest bill before it. */
export interface CardPayment {
  id: string;
  cardId: string;
  date: ISODate;
  /** Above zero, in INR. */
  amount: number;
}

export interface EntityMap {
  member: Member;
  account: Account;
  instrument: Instrument;
  transaction: Transaction;
  snapshot: Snapshot;
  group: Group;
  manualPrice: ManualPrice;
  dismissal: Dismissal;
  setting: Setting;
  loan: Loan;
  loanEntry: LoanEntry;
  card: Card;
  cardBill: CardBill;
  cardPayment: CardPayment;
}

export type EntityName = keyof EntityMap;

export const ENTITY_NAMES: readonly EntityName[] = [
  'member',
  'account',
  'instrument',
  'transaction',
  'snapshot',
  'group',
  'manualPrice',
  'dismissal',
  'setting',
  'loan',
  'loanEntry',
  'card',
  'cardBill',
  'cardPayment',
];
