// SPDX-License-Identifier: AGPL-3.0-only
import type { Currency, Instrument, ManualPrice, Snapshot } from '../model/types.ts';
import type { ISODate } from '../util/dates.ts';

/** A price from a source. Keys look like 'amfi:147481', 'nse:NIFTYBEES', 'isin:INE…', 'fx:USDINR'. */
export interface Price {
  key: string;
  date: ISODate;
  close: number;
  currency: Currency;
  source: string;
}

export type PriceOrigin = 'manual' | 'feed' | 'snapshot';

export interface ResolvedPrice {
  price: number;
  date: ISODate;
  origin: PriceOrigin;
}

type Series = { date: ISODate; close: number }[];

/** Latest entry on or before date, by binary search on a date-sorted series. */
function onOrBefore<T extends { date: ISODate }>(
  series: readonly T[],
  date: ISODate,
): T | undefined {
  let lo = 0;
  let hi = series.length - 1;
  let found: T | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;

    if (series[mid]!.date <= date) {
      found = series[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found;
}

export function priceKeys(i: Instrument): string[] {
  const keys: string[] = [];

  if (i.ids.amfi) {
    keys.push(`amfi:${i.ids.amfi}`);
  }

  if (i.ids.isin) {
    keys.push(`isin:${i.ids.isin.toUpperCase()}`);
  }

  if (i.ids.nse) {
    keys.push(`nse:${i.ids.nse.toUpperCase()}`);
  }

  if (i.ids.bse) {
    keys.push(`bse:${i.ids.bse}`);
  }

  if (i.ids.us) {
    keys.push(`us:${i.ids.us.toUpperCase()}`);
  }

  return keys;
}

/**
 * Answers "what was this worth on that date". A manual price wins if it is at least as new as the
 * feed's; then the feed; then the last holdings snapshot. Callers fall back to cost.
 */
export class PriceBook {
  private feed = new Map<string, Series>();
  private manual = new Map<string, Series>();
  private snaps = new Map<string, Series>();

  constructor(
    prices: Iterable<Price> = [],
    manual: Iterable<ManualPrice> = [],
    snapshots: Iterable<Snapshot> = [],
  ) {
    const push = (map: Map<string, Series>, key: string, date: ISODate, close: number) => {
      if (!(close > 0)) {
        return;
      }

      let series = map.get(key);

      if (!series) {
        map.set(key, (series = []));
      }

      series.push({ date, close });
    };

    for (const p of prices) {
      push(this.feed, p.key, p.date, p.close);
    }

    for (const m of manual) {
      push(this.manual, m.instrumentId, m.date, m.price);
    }

    for (const s of snapshots) {
      const price =
        s.price ?? (s.value !== undefined && s.units > 0 ? s.value / s.units : undefined);

      if (price !== undefined) {
        push(this.snaps, s.instrumentId, s.asOf, price);
      }
    }

    for (const map of [this.feed, this.manual, this.snaps]) {
      for (const [key, series] of map) {
        series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        // Keep the last entry per date.
        map.set(
          key,
          series.filter((e, n) => series[n + 1]?.date !== e.date),
        );
      }
    }
  }

  /** The newest feed price on or before date across the instrument's keys. */
  feedPrice(i: Instrument, date: ISODate): { date: ISODate; close: number } | undefined {
    let best: { date: ISODate; close: number } | undefined;

    for (const key of priceKeys(i)) {
      const hit = onOrBefore(this.feed.get(key) ?? [], date);

      if (hit && (!best || hit.date > best.date)) {
        best = hit;
      }
    }

    return best;
  }

  price(i: Instrument, date: ISODate): ResolvedPrice | undefined {
    const feed = this.feedPrice(i, date);
    const manual = onOrBefore(this.manual.get(i.id) ?? [], date);

    if (manual && (!feed || manual.date >= feed.date)) {
      return { price: manual.close, date: manual.date, origin: 'manual' };
    }

    if (feed) {
      return { price: feed.close, date: feed.date, origin: 'feed' };
    }

    const snap = onOrBefore(this.snaps.get(i.id) ?? [], date);

    if (snap) {
      return { price: snap.close, date: snap.date, origin: 'snapshot' };
    }

    return undefined;
  }

  /** INR per unit of currency on or before date; the earliest known rate before any is known. */
  fx(currency: Currency, date: ISODate): { rate: number; date?: ISODate } | undefined {
    if (currency === 'INR') {
      return { rate: 1 };
    }

    const series = this.feed.get(`fx:${currency}INR`) ?? [];
    const hit = onOrBefore(series, date) ?? series[0];

    return hit ? { rate: hit.close, date: hit.date } : undefined;
  }
}
