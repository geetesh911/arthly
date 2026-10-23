// SPDX-License-Identifier: AGPL-3.0-only
import type { Filter } from '../../engine/portfolio.ts';
import type { PriceBook } from '../../engine/prices.ts';
import type { RateTables } from '../../engine/rates.ts';
import type { State } from '../../log/replay.ts';
import type { ISODate } from '../../util/dates.ts';

export interface ExportInput {
  state: State;
  book: PriceBook;
  date: ISODate;
  filter?: Filter;
  rates?: RateTables;
}

export interface Exporter {
  id: string;
  label: string;
  extension: string;
  mime: string;
  /** Excel and JSON exports aren't encrypted; the app says so before saving. */
  encrypted: boolean;
  run(input: ExportInput): Promise<Uint8Array>;
}
