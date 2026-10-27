// SPDX-License-Identifier: AGPL-3.0-only
import type { Put } from '../log/events.ts';
import type {
  AccountKind,
  AssetClass,
  BondTerms,
  Currency,
  DepositTerms,
  InstrumentIds,
  InstrumentKind,
  PpfTerms,
  TransactionType,
} from '../model/types.ts';
import type { ISODate } from '../util/dates.ts';

export type Cell = string | number | boolean | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export interface PdfPage {
  lines: string[];
}

export interface InputFile {
  name: string;
  bytes: Uint8Array;
  /** Spreadsheet contents; dates come back as ISO strings. */
  sheets(): Promise<Sheet[]>;
  /** Text of a PDF, one entry per page. */
  pdfText(password?: string): Promise<PdfPage[]>;
}

/** Drafts refer to each other by `ref`, a name local to the draft. */
export interface AccountDraft {
  ref: string;
  institution: string;
  kind: AccountKind;
  label: string;
  /** Already masked. */
  maskedRef?: string;
  currency: Currency;
  /**
   * For files that don't say which account, such as Groww's fund orders with no folio: each line
   * goes to the member's account of this kind that already holds its instrument, and to this
   * account only when none does.
   */
  byHolding?: boolean;
}

export interface InstrumentDraft {
  ref: string;
  kind: InstrumentKind;
  name: string;
  currency: Currency;
  assetClass?: AssetClass;
  ids: InstrumentIds;
  /** Words that help matching: AMC, category. */
  hints?: { amc?: string; category?: string; subCategory?: string };
  terms?: DepositTerms | BondTerms | PpfTerms;
}

export interface TxnDraft {
  account: string;
  instrument: string;
  date: ISODate;
  type: TransactionType;
  units?: number;
  price?: number;
  amount: number;
  currency: Currency;
  meta?: Record<string, string>;
}

export interface SnapshotDraft {
  account: string;
  instrument: string;
  asOf: ISODate;
  units: number;
  invested?: number;
  value?: number;
  price?: number;
  /** The file's own XIRR for the holding, as a fraction. */
  xirr?: number;
  /**
   * On the balance a statement starts from: warnings for the preview, left out when the vault
   * already has this holding up to that day, as from the statement for the year before.
   */
  openingWarnings?: string[];
}

export interface ImportDraft {
  asOf?: ISODate;
  accounts: AccountDraft[];
  instruments: InstrumentDraft[];
  transactions: TxnDraft[];
  snapshots: SnapshotDraft[];
  /** The file's own totals, to compare with the sum of its lines. */
  totals?: { invested?: number; value?: number };
  /** Whole records with IDs, from the app's own exports and template. */
  records?: Put[];
  warnings: string[];
}

/** One scheme from AMFI's list, as published by the price feed. */
export interface AmfiScheme {
  code: string;
  isinGrowth?: string;
  isinReinvest?: string;
  name: string;
  category?: string;
}

export interface ImportContext {
  memberId: string;
  today: ISODate;
  /** AMFI's scheme list, for matching fund names; absent when offline. */
  amfi?: AmfiScheme[];
}

export interface Importer {
  id: string;
  version: number;
  label: string;
  extensions: string[];
  /** 0..1, judged by heading text, never by cell position. */
  detect(file: InputFile): Promise<number>;
  parse(file: InputFile, ctx: ImportContext): Promise<ImportDraft>;
}
