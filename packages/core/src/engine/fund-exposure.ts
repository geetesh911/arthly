// SPDX-License-Identifier: AGPL-3.0-only
import type { AmfiScheme } from '../import/types.ts';
import type { AssetClass } from '../model/types.ts';
import type { CapRow } from '../plugins/prices/caps/caps.ts';
import { normaliseFundName } from '../plugins/prices/fund-holdings/parse.ts';
import type { FundConstituent, FundPortfolio } from '../plugins/prices/fund-holdings/types.ts';
import type { StockReference } from '../plugins/prices/reference.ts';
import { sectorOfIndustry } from '../plugins/prices/sectors.ts';
import { daysBetween, isISODate } from '../util/dates.ts';

import { breakdown, type ExposureRow, finishConcentration } from './analytics-common.ts';
import type { Holding } from './portfolio.ts';

export interface FundConstituentExposure extends FundConstituent {
  value: number;
  unresolved?: boolean;
}
export interface FundExposureDetail {
  key: string;
  name: string;
  value: number;
  status: 'available' | 'partial' | 'unavailable';
  asOf?: string;
  sourceUrl?: string;
  /** An AMC's id, or 'file' for a report added by hand. */
  source?: string;
  /** The matched report's id (FundPortfolio.id). */
  reportId?: string;
  dates: string[];
  coverage: number;
  stale: boolean;
  /** A report kept from an earlier refresh, because the latest one didn't bring it. */
  retained: boolean;
  derivatives: boolean;
  warnings: string[];
  constituents: FundConstituentExposure[];
}
export interface FundOverlap {
  first: string;
  second: string;
  share: number;
  stocks: number;
}
export interface FundExposureReference {
  portfolios?: FundPortfolio[];
  /** Ids of portfolios kept from an earlier refresh (FundHoldingsFile.retained). */
  retained?: string[] | undefined;
  schemes?: AmfiScheme[];
  /** NSE's index lists: each stock's sector. */
  stocks?: StockReference[];
  /** AMFI's categorisation: each listed company's cap size. */
  caps?: CapRow[];
}

/** Exact name/identifier matching: ambiguous scheme matches never acquire someone else's weights. */
function portfolioLookup(portfolios: FundPortfolio[], schemes: AmfiScheme[]) {
  // AMCs spell index names both "Large Midcap 250" and "LargeMidcap250".
  // Ignore spacing only; all words and digits must still agree exactly.
  const nameKey = (name: string) => normaliseFundName(name).replaceAll(' ', '');
  // Groww sometimes leaves out "Fund": "Example Value Direct Plan Growth".
  const shortKey = (name: string) => nameKey(name).replace(/fund$/, '');
  const names = new Map<string, FundPortfolio[]>();
  const shortNames = new Map<string, FundPortfolio[]>();
  const codes = new Map<string, FundPortfolio[]>();
  const isins = new Map<string, FundPortfolio[]>();
  const add = (map: Map<string, FundPortfolio[]>, key: string, p: FundPortfolio) =>
    map.set(key, [...(map.get(key) ?? []), p]);

  for (const p of portfolios) {
    add(names, nameKey(p.schemeName), p);
    add(shortNames, shortKey(p.schemeName), p);

    for (const c of p.amfiCodes ?? []) {
      add(codes, c, p);
    }

    for (const i of p.schemeIsins ?? []) {
      add(isins, i.toUpperCase(), p);
    }
  }

  const unique = (list: FundPortfolio[] | undefined) => (list?.length === 1 ? list[0] : undefined);
  const byName = (name: string) =>
    unique(names.get(nameKey(name))) ?? unique(shortNames.get(shortKey(name)));

  for (const s of schemes) {
    const p = byName(s.name);

    if (!p) {
      continue;
    }

    if (!codes.has(s.code)) {
      add(codes, s.code, p);
    }

    for (const i of [s.isinGrowth, s.isinReinvest]) {
      if (i && !isins.has(i.toUpperCase())) {
        add(isins, i.toUpperCase(), p);
      }
    }
  }

  return (name: string, amfi?: string, isin?: string) =>
    (amfi ? unique(codes.get(amfi)) : undefined) ??
    (isin ? unique(isins.get(isin.toUpperCase())) : undefined) ??
    byName(name);
}

export function fundExposure(
  holdings: Holding[],
  date: string,
  reference: FundExposureReference = {},
) {
  const held = holdings.filter((h) => h.value > 0 && h.status !== 'closed');
  const total = held.reduce((n, h) => n + h.value, 0);
  const lookup = portfolioLookup(
    (reference.portfolios ?? []).filter((p) => isISODate(p.asOf) && p.asOf <= date),
    reference.schemes ?? [],
  );
  const retainedIds = new Set(reference.retained);
  const stocksByIsin = new Map(reference.stocks?.map((s) => [s.isin.toUpperCase(), s]));
  const stocksBySymbol = new Map(reference.stocks?.map((s) => [s.symbol.toUpperCase(), s]));
  const capsByIsin = new Map(reference.caps?.map((c) => [c.isin.toUpperCase(), c.cap]));
  const capsBySymbol = new Map(
    reference.caps?.flatMap((c) => (c.nse ? [[c.nse.toUpperCase(), c.cap] as const] : [])),
  );
  const capLabels = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap' };
  // The sector any fund report's industry gives a stock, which also covers direct holdings.
  const reportSectors = new Map<string, string>();

  for (const p of reference.portfolios ?? []) {
    for (const c of p.constituents) {
      const sector = c.kind === 'stock' && c.isin ? sectorOfIndustry(c.industry) : undefined;

      if (sector && !reportSectors.has(c.isin!.toUpperCase())) {
        reportSectors.set(c.isin!.toUpperCase(), sector);
      }
    }
  }

  const assets = new Map<string, number>();
  const sectors: { label: string; value: number }[] = [];
  const caps: { label: string; value: number }[] = [];
  const stockRows = new Map<string, ExposureRow>();
  const groupedFunds = new Map<string, { holding: Holding; value: number }>();
  const addAsset = (label: string, value: number) =>
    assets.set(label, (assets.get(label) ?? 0) + value);

  const addStock = (c: FundConstituent, value: number, direct?: Holding) => {
    if (value <= 0) {
      return;
    }

    const known = c.isin ? stocksByIsin.get(c.isin.toUpperCase()) : undefined;
    const key = c.isin
      ? `isin:${c.isin.toUpperCase()}`
      : direct?.instrument.ids.us
        ? `us:${direct.instrument.ids.us.toUpperCase()}`
        : direct?.instrument.ids.bse
          ? `bse:${direct.instrument.ids.bse}`
          : direct?.instrument.ids.nse
            ? `nse:${direct.instrument.ids.nse.toUpperCase()}`
            : (direct?.instrument.id ?? `name:${c.name}`);
    const row = stockRows.get(key) ?? {
      key,
      name: c.name,
      value: 0,
      gain: 0,
      invested: 0,
      share: 0,
      portfolioShare: 0,
      directValue: 0,
      indirectValue: 0,
    };

    row.value += value;

    if (direct) {
      row.directValue = (row.directValue ?? 0) + value;

      if (row.invested !== null) {
        row.invested += direct.invested;
      }

      if (row.gain !== null) {
        row.gain += direct.gain;
      }
    } else {
      row.indirectValue = (row.indirectValue ?? 0) + value;
      row.gain = null;
      row.invested = null;
    }

    stockRows.set(key, row);
    // NSE's own list first, then the industry this report or another one gives the stock.
    const isin = c.isin?.toUpperCase();
    const sector =
      known?.industry || sectorOfIndustry(c.industry) || (isin && reportSectors.get(isin));
    const symbol = direct?.instrument.ids.nse?.toUpperCase();
    const cap =
      (isin ? capsByIsin.get(isin) : undefined) ?? (symbol ? capsBySymbol.get(symbol) : undefined);

    sectors.push({ label: sector || 'Unclassified', value });
    caps.push({ label: cap ? capLabels[cap] : 'Unclassified', value });
  };

  for (const h of held) {
    const i = h.instrument;

    if (i.kind === 'mf' || i.kind === 'etf') {
      const key = i.ids.isin
        ? `isin:${i.ids.isin.toUpperCase()}`
        : i.ids.amfi
          ? `amfi:${i.ids.amfi}`
          : i.id;
      const g = groupedFunds.get(key) ?? { holding: h, value: 0 };

      g.value += h.value;
      groupedFunds.set(key, g);
    } else {
      addAsset(i.assetClass, h.value);

      if (i.kind === 'stock' || i.kind === 'us-stock') {
        // ISIN first, then symbol: an ISIN changes after a split, but funds report the new one.
        const known =
          (i.ids.isin ? stocksByIsin.get(i.ids.isin.toUpperCase()) : undefined) ??
          (i.ids.nse ? stocksBySymbol.get(i.ids.nse.toUpperCase()) : undefined);
        const isin = known?.isin ?? i.ids.isin;

        addStock(
          {
            name: i.name,
            ...(isin ? { isin } : {}),
            kind: 'stock',
            assetClass: 'equity',
            weight: 1,
          },
          h.value,
          h,
        );
      }
    }
  }

  const funds: FundExposureDetail[] = [];
  let fundTotal = 0,
    covered = 0,
    byFundType = 0;

  for (const [key, { holding, value }] of groupedFunds) {
    fundTotal += value;
    const i = holding.instrument;
    const p = lookup(i.name, i.ids.amfi, i.ids.isin);
    const leaves: FundConstituentExposure[] = [];
    const dates = new Set<string>();
    const warnings = new Set<string>();
    let derivatives = false,
      retained = false;
    const unknown = (name: string, weight: number, cls: AssetClass = 'other') =>
      leaves.push({
        name,
        weight,
        value: weight * value,
        kind: 'other',
        assetClass: cls,
        unresolved: true,
      });

    const expand = (portfolio: FundPortfolio, multiplier: number, path: Set<string>) => {
      if (path.has(portfolio.id) || path.size >= 8) {
        unknown(`${portfolio.schemeName} (unresolved)`, multiplier);
        warnings.add('A nested fund could not be expanded because of a cycle or depth limit.');

        return;
      }

      dates.add(portfolio.asOf);
      derivatives ||= portfolio.derivatives;
      retained ||= retainedIds.has(portfolio.id);

      for (const warning of portfolio.warnings) {
        warnings.add(warning);
      }

      const next = new Set([...path, portfolio.id]);
      let sum = 0;

      for (const c of portfolio.constituents) {
        if (!Number.isFinite(c.weight)) {
          continue;
        }

        sum += c.weight;
        const weight = multiplier * c.weight;

        if (c.kind === 'fund') {
          const nested = lookup(c.name, c.amfi, c.isin);

          if (nested) {
            expand(nested, weight, next);
          } else {
            unknown(`${c.name} (holdings unavailable)`, weight, c.assetClass);
          }
        } else {
          leaves.push({ ...c, weight, value: weight * value });
        }
      }

      // Reports pass only when their weights total within 2% of 100%, so the gap is rounding:
      // it keeps the value whole without counting as uncovered or as unknown stocks.
      if (Math.abs(1 - sum) > 1e-8) {
        const gap = multiplier * (1 - sum);

        leaves.push({
          name: 'Unallocated / rounding',
          weight: gap,
          value: gap * value,
          kind: 'other',
          assetClass: 'other',
        });
      }
    };

    if (p) {
      expand(p, 1, new Set());
    } else {
      unknown(`${i.name} (holdings unavailable)`, 1, i.assetClass);
    }

    const missingWeight = Math.min(
      1,
      Math.max(
        0,
        leaves.filter((c) => c.unresolved && c.weight > 0).reduce((n, c) => n + c.weight, 0),
      ),
    );
    const coverage = Math.max(0, Math.min(1, 1 - missingWeight));

    covered += value * coverage;
    const map = new Map<string, FundConstituentExposure>();

    for (const c of leaves) {
      // A fund without a report counts under its own type, such as a gold ETF under gold.
      addAsset(c.assetClass, c.value);

      if (c.unresolved) {
        byFundType += c.value;
      }

      if (c.kind === 'stock') {
        addStock(c, c.value);
      } else if (
        c.unresolved &&
        c.value > 0 &&
        ['equity', 'hybrid', 'other'].includes(c.assetClass)
      ) {
        sectors.push({ label: 'Unclassified', value: c.value });
        caps.push({ label: 'Unclassified', value: c.value });
      }

      const id = `${c.kind}:${c.isin ?? c.name}`;
      const existing = map.get(id);

      if (existing) {
        existing.weight += c.weight;
        existing.value += c.value;
      } else {
        map.set(id, { ...c });
      }
    }

    funds.push({
      key,
      name: i.name,
      value,
      status: !p ? 'unavailable' : coverage < 0.999 ? 'partial' : 'available',
      ...(p ? { asOf: p.asOf, sourceUrl: p.sourceUrl, source: p.source, reportId: p.id } : {}),
      dates: [...dates].sort(),
      coverage,
      stale: [...dates].some((d) => daysBetween(d, date) > 45),
      retained,
      derivatives,
      warnings: [...warnings],
      constituents: [...map.values()].sort((a, b) => b.weight - a.weight),
    });
  }

  const overlap: FundOverlap[] = [];

  for (let a = 0; a < funds.length; a++) {
    for (let b = a + 1; b < funds.length; b++) {
      const x = funds[a]!,
        y = funds[b]!;

      if (x.status === 'unavailable' || y.status === 'unavailable') {
        continue;
      }

      const weights = new Map(
        x.constituents
          .filter((c) => c.kind === 'stock' && c.isin)
          .map((c) => [c.isin!.toUpperCase(), c.weight]),
      );
      let overlapShare = 0,
        count = 0;

      for (const c of y.constituents) {
        if (c.kind === 'stock' && c.isin && weights.has(c.isin.toUpperCase())) {
          overlapShare += Math.min(c.weight, weights.get(c.isin.toUpperCase())!);
          count++;
        }
      }

      if (count) {
        overlap.push({ first: x.name, second: y.name, share: overlapShare, stocks: count });
      }
    }
  }

  const adjustments = [...assets.values()].filter((v) => v < 0).reduce((n, v) => n + v, 0);

  return {
    stocks: finishConcentration([...stockRows.values()], total),
    sectors: breakdown(sectors),
    marketCap: breakdown(caps),
    assetSplit: breakdown(
      [...assets].filter(([, v]) => v > 0).map(([label, value]) => ({ label, value })),
    ),
    adjustments,
    /** The part of the asset split placed by fund type, because no report was available. */
    byFundType,
    funds: funds.sort((a, b) => b.value - a.value),
    overlap: overlap.sort((a, b) => b.share - a.share).slice(0, 20),
    coverage: {
      total: fundTotal,
      covered,
      missing: Math.max(0, fundTotal - covered),
      oldest: funds.flatMap((f) => f.dates).sort()[0] ?? null,
    },
  };
}
