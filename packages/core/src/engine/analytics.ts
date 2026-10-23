// SPDX-License-Identifier: AGPL-3.0-only
import type { AmfiScheme } from '../import/types.ts';
import type { Instrument } from '../model/types.ts';
import type { StockReference } from '../plugins/prices/reference.ts';
import { daysBetween } from '../util/dates.ts';

import {
  type Breakdown,
  breakdown,
  type Concentration,
  type ExposureRow,
  finishConcentration,
} from './analytics-common.ts';
import { fundExposure, type FundExposureReference } from './fund-exposure.ts';
import type { LoanTotals } from './loans.ts';
import type { Holding } from './portfolio.ts';
export type { Breakdown, Concentration, ExposureRow, Slice } from './analytics-common.ts';

/** The slice for money lent, where a chart counts it. What you owe is never a slice. */
export const OWED_TO_YOU = 'Owed to you';
export interface Analytics {
  date: string;
  total: number;
  count: number;
  assetSplit: Breakdown;
  instrumentSplit: Breakdown;
  sectors: Breakdown;
  marketCap: Breakdown;
  strategy: Breakdown;
  currency: Breakdown;
  stocks: Concentration;
  holdings: Concentration;
  valuation: { total: number; stale: number; estimated: number };
  /** Open loan balances. Only what you're owed is charted. */
  loans: Pick<LoanTotals, 'owedToYou' | 'youOwe'>;
  /** What's left to pay on cards. Never charted. */
  cardDues: number;
  lookthrough: Pick<
    ReturnType<typeof fundExposure>,
    'funds' | 'coverage' | 'overlap' | 'assetSplit' | 'adjustments' | 'byFundType'
  >;
}

function identity(i: Instrument, reference?: StockReference): string {
  const isin = i.ids.isin || reference?.isin;

  return isin
    ? `isin:${isin.toUpperCase()}`
    : i.ids.amfi
      ? `amfi:${i.ids.amfi}`
      : i.ids.nse
        ? `nse:${i.ids.nse.toUpperCase()}`
        : i.ids.bse
          ? `bse:${i.ids.bse.toUpperCase()}`
          : i.ids.us
            ? `us:${i.ids.us.toUpperCase()}`
            : i.id;
}

function concentration(
  holdings: Holding[],
  total: number,
  keyFor: (h: Holding) => string,
): Concentration {
  const map = new Map<string, ExposureRow>();

  for (const h of holdings) {
    const key = keyFor(h);
    const r = map.get(key) ?? {
      key,
      name: h.instrument.name,
      value: 0,
      invested: 0,
      gain: 0,
      share: 0,
      portfolioShare: 0,
    };

    r.value += h.value;
    r.invested = (r.invested ?? 0) + h.invested;
    r.gain = (r.gain ?? 0) + h.gain;
    map.set(key, r);
  }

  return finishConcentration([...map.values()], total);
}

const KIND_LABELS: Record<Instrument['kind'], string> = {
  stock: 'Indian stocks',
  'us-stock': 'US stocks',
  mf: 'Mutual funds',
  etf: 'ETFs',
  sgb: 'Sovereign gold bonds',
  bond: 'Bonds',
  fd: 'Fixed deposits',
  ppf: 'PPF',
  epf: 'EPF',
  eps: 'EPS',
  cash: 'Bank / cash',
  other: 'Other',
};

export function portfolioAnalytics(
  holdings: Holding[],
  date: string,
  reference: FundExposureReference = {},
  loans: Pick<LoanTotals, 'owedToYou' | 'youOwe'> = { owedToYou: 0, youOwe: 0 },
  cardDues = 0,
): Analytics {
  const held = holdings.filter((h) => h.value > 0 && h.status !== 'closed');
  const total = held.reduce((n, h) => n + h.value, 0);
  const schemesByCode = new Map(reference.schemes?.map((s) => [s.code, s]));
  const schemesByIsin = new Map<string, AmfiScheme>();

  for (const s of reference.schemes ?? []) {
    for (const isin of [s.isinGrowth, s.isinReinvest]) {
      if (isin) {
        schemesByIsin.set(isin.toUpperCase(), s);
      }
    }
  }

  const stocksByIsin = new Map(reference.stocks?.map((s) => [s.isin.toUpperCase(), s]));
  const stocksBySymbol = new Map(reference.stocks?.map((s) => [s.symbol.toUpperCase(), s]));

  const words = (h: Holding) => {
    const i = h.instrument;
    const s =
      (i.ids.amfi ? schemesByCode.get(i.ids.amfi) : undefined) ??
      (i.ids.isin ? schemesByIsin.get(i.ids.isin.toUpperCase()) : undefined);

    return `${i.name} ${s?.name ?? ''} ${s?.category ?? ''}`.toLowerCase();
  };

  const stock = (h: Holding) =>
    (h.instrument.ids.isin ? stocksByIsin.get(h.instrument.ids.isin.toUpperCase()) : undefined) ??
    (h.instrument.ids.nse ? stocksBySymbol.get(h.instrument.ids.nse.toUpperCase()) : undefined);
  const funds = held.filter((h) => ['mf', 'etf'].includes(h.instrument.kind));
  const split = (list: Holding[], label: (h: Holding) => string, owed = 0) =>
    breakdown([
      ...list.map((h) => ({ label: label(h), value: h.value })),
      { label: OWED_TO_YOU, value: owed },
    ]);
  const underlying = fundExposure(held, date, reference);
  const marketHoldings = held.filter((h) =>
    ['stock', 'us-stock', 'mf', 'etf'].includes(h.instrument.kind),
  );

  return {
    date,
    total,
    count: held.length,
    loans: { owedToYou: loans.owedToYou, youOwe: loans.youOwe },
    cardDues,
    assetSplit: split(held, (h) => h.instrument.assetClass, loans.owedToYou),
    instrumentSplit: split(held, (h) => KIND_LABELS[h.instrument.kind]),
    sectors: underlying.sectors,
    marketCap: underlying.marketCap,
    strategy: split(funds, (h) => {
      const w = words(h);

      if (/\bactive(?:ly)?\b/.test(w)) {
        return 'Active';
      }

      // An FoF's wrapper does not establish how its underlying funds are managed.
      if (/\bfof\b|fund(?:s)? of fund/.test(w)) {
        return 'Unclassified';
      }

      if (h.instrument.kind === 'etf' || /\betf\b|\bindex(?:ed)?\b|passive/.test(w)) {
        return 'Passive';
      }

      if (
        /equity scheme|debt scheme|hybrid scheme|flexi\s*cap|multi\s*cap|large\s*cap|mid\s*cap|small\s*cap|elss|liquid fund|overnight fund|balanced advantage/.test(
          w,
        )
      ) {
        return 'Active';
      }

      return 'Unclassified';
    }),
    currency: split(held, (h) => h.instrument.currency),
    stocks: underlying.stocks,
    holdings: concentration(held, total, (h) => identity(h.instrument, stock(h))),
    lookthrough: {
      funds: underlying.funds,
      coverage: underlying.coverage,
      overlap: underlying.overlap,
      assetSplit: underlying.assetSplit,
      adjustments: underlying.adjustments,
      byFundType: underlying.byFundType,
    },
    valuation: {
      total: marketHoldings.reduce((n, h) => n + h.value, 0),
      stale: marketHoldings
        .filter((h) => h.priceDate && daysBetween(h.priceDate, date) > 4)
        .reduce((n, h) => n + h.value, 0),
      estimated: marketHoldings.filter((h) => h.estimate).reduce((n, h) => n + h.value, 0),
    },
  };
}
