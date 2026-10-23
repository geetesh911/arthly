// SPDX-License-Identifier: AGPL-3.0-only
// Planning: allocation targets and where new money goes, access to your money, and the
// emergency fund. Analytics describes what you hold; this is about what to do next.
import type { AmfiScheme } from '../import/types.ts';
import type { AssetClass, BondTerms, DepositTerms } from '../model/types.ts';
import { daysBetween } from '../util/dates.ts';

import { OWED_TO_YOU } from './analytics.ts';
import { type Breakdown, breakdown, shareOf as share } from './analytics-common.ts';
import {
  fundExposure,
  type FundExposureDetail,
  type FundExposureReference,
  ROUNDING_GAP,
} from './fund-exposure.ts';
import type { LoanTotals } from './loans.ts';
import type { Holding } from './portfolio.ts';

export const ASSET_CLASSES: AssetClass[] = [
  'equity',
  'debt',
  'hybrid',
  'gold',
  'silver',
  'cash',
  'other',
];
export type AllocationTargets = Partial<Record<AssetClass, number>>;
/** New money only never sells; rebalance buys and sells to reach the targets. */
export type RebalanceMode = 'new-money' | 'rebalance';
export interface AllocationPlanSettings {
  mode: RebalanceMode;
  /** How far, in percentage points, a class may drift from its target before it's flagged. */
  band: number;
  /** The amount to invest: a lump sum or a month's SIPs. */
  amount: number;
}
export interface EmergencySettings {
  monthlyExpenses: number;
  months: number;
}
/** Money you can reach within a day or two. */
export interface EmergencyMoney {
  cash: number;
  /** Funds with asset class Cash: liquid, overnight and money market funds by default. */
  cashFunds: number;
  deposits: number;
}
export const DEFAULT_BAND = 5;
export const DEFAULT_MONTHS = 6;
export const MAX_BAND = 50;
export const MAX_MONTHS = 36;

/** How a hybrid fund was split: by its holdings report, by its type, or as an arbitrage fund. */
export type HybridMethod = 'report' | 'type' | 'arbitrage';
export interface HybridFund {
  /** The instrument's id. */
  id: string;
  name: string;
  value: number;
  method: HybridMethod;
  /** Its type, such as Balanced advantage, from its AMFI category and name. */
  type: string;
  /** Each class's share of the fund, as a fraction. */
  split: AllocationTargets;
  /** The report's date, when split by its report. */
  asOf?: string;
  /** Its report has futures, which hedge stocks the split still counts as equity. */
  hedged: boolean;
}

/** A hybrid fund's split when there's no report, by type; the first match wins. */
const HYBRID_TYPES: { type: string; match: RegExp; split: AllocationTargets }[] = [
  { type: 'Arbitrage', match: /arbitrage/, split: { debt: 1 } },
  {
    type: 'Multi-asset',
    match: /multi[\s-]*asset/,
    split: { equity: 0.5, debt: 0.3, gold: 0.2 },
  },
  {
    type: 'Balanced advantage',
    match: /balanced advantage|dynamic asset allocation/,
    split: { equity: 0.5, debt: 0.5 },
  },
  { type: 'Equity savings', match: /equity savings/, split: { equity: 0.35, debt: 0.65 } },
  { type: 'Conservative hybrid', match: /conservative hybrid/, split: { equity: 0.2, debt: 0.8 } },
  {
    type: 'Aggressive hybrid',
    match: /aggressive hybrid|equity (?:&|and) debt|hybrid equity/,
    split: { equity: 0.7, debt: 0.3 },
  },
  { type: 'Balanced hybrid', match: /balanced hybrid/, split: { equity: 0.5, debt: 0.5 } },
];
const OTHER_HYBRID = { type: 'Hybrid', split: { equity: 0.5, debt: 0.5 } };

const isHybridFund = (h: Holding) =>
  (h.instrument.kind === 'mf' || h.instrument.kind === 'etf') &&
  h.instrument.assetClass === 'hybrid';

/** A fund's split by its report: the rounding gap and negative classes left out, then scaled. */
function reportSplit(detail: FundExposureDetail, typical: AllocationTargets) {
  const weights: AllocationTargets = {};
  const add = (cls: AssetClass, weight: number) => (weights[cls] = (weights[cls] ?? 0) + weight);

  for (const c of detail.constituents) {
    if (c.name === ROUNDING_GAP) {
      continue;
    }

    // A nested hybrid fund without a report is split by the outer fund's type.
    if (c.assetClass === 'hybrid') {
      for (const [cls, part] of Object.entries(typical)) {
        add(cls as AssetClass, c.weight * (part ?? 0));
      }
    } else {
      add(c.assetClass, c.weight);
    }
  }

  const kept = Object.entries(weights).filter(([, w]) => w > 0) as [AssetClass, number][];
  const total = kept.reduce((n, [, w]) => n + w, 0);

  return total > 0 ? Object.fromEntries(kept.map(([c, w]) => [c, w / total])) : null;
}

/** Each hybrid fund once, with how it splits into the other asset classes. */
function hybridFunds(
  held: Holding[],
  date: string,
  reference: FundExposureReference,
): HybridFund[] {
  const byCode = new Map(reference.schemes?.map((s) => [s.code, s]));
  const byIsin = new Map<string, AmfiScheme>();
  const groups = new Map<string, { holding: Holding; value: number }>();

  for (const s of reference.schemes ?? []) {
    for (const isin of [s.isinGrowth, s.isinReinvest]) {
      if (isin) {
        byIsin.set(isin.toUpperCase(), s);
      }
    }
  }

  // The same fund in several accounts is one fund.
  for (const h of held.filter(isHybridFund)) {
    const g = groups.get(h.instrument.id) ?? { holding: h, value: 0 };

    g.value += h.value;
    groups.set(h.instrument.id, g);
  }

  return [...groups.values()].map(({ holding, value }): HybridFund => {
    const i = holding.instrument;
    const scheme =
      (i.ids.amfi ? byCode.get(i.ids.amfi) : undefined) ??
      (i.ids.isin ? byIsin.get(i.ids.isin.toUpperCase()) : undefined);
    const words = `${i.name} ${scheme?.name ?? ''} ${scheme?.category ?? ''}`.toLowerCase();
    const typical = HYBRID_TYPES.find((t) => t.match.test(words)) ?? OTHER_HYBRID;
    const base = { id: i.id, name: i.name, value, type: typical.type, hedged: false };

    // Arbitrage funds hedge every stock they hold, so they count as debt whatever they report.
    if (typical.type === 'Arbitrage') {
      return { ...base, method: 'arbitrage', split: typical.split };
    }

    const detail = fundExposure([holding], date, reference).funds[0];
    const split = detail && detail.status !== 'unavailable' && reportSplit(detail, typical.split);

    return split
      ? {
          ...base,
          method: 'report',
          split,
          hedged: detail.derivatives,
          ...(detail.asOf ? { asOf: detail.asOf } : {}),
        }
      : { ...base, method: 'type', split: typical.split };
  });
}

export interface Planning {
  date: string;
  total: number;
  /** Value by asset class, with hybrid funds split into the classes they hold. */
  assetValues: AllocationTargets;
  hybrid: HybridFund[];
  liquidity: Breakdown;
  maturities: Breakdown;
  emergency: EmergencyMoney;
}

export function planning(
  holdings: Holding[],
  date: string,
  reference: FundExposureReference = {},
  loans: Pick<LoanTotals, 'owedToYou'> = { owedToYou: 0 },
): Planning {
  const held = holdings.filter((h) => h.value > 0 && h.status !== 'closed');
  const hybrid = hybridFunds(held, date, reference);
  const assetValues: AllocationTargets = {};
  const emergency: EmergencyMoney = { cash: 0, cashFunds: 0, deposits: 0 };
  const addValue = (cls: AssetClass, value: number) =>
    (assetValues[cls] = (assetValues[cls] ?? 0) + value);

  for (const f of hybrid) {
    for (const [cls, part] of Object.entries(f.split)) {
      addValue(cls as AssetClass, f.value * (part ?? 0));
    }
  }

  for (const h of held) {
    const { kind, assetClass } = h.instrument;

    if (!isHybridFund(h)) {
      addValue(assetClass, h.value);
    }

    if (kind === 'cash') {
      emergency.cash += h.value;
    } else if ((kind === 'mf' || kind === 'etf') && assetClass === 'cash') {
      emergency.cashFunds += h.value;
    } else if (kind === 'fd') {
      emergency.deposits += h.value;
    }
  }

  return {
    date,
    total: held.reduce((n, h) => n + h.value, 0),
    assetValues,
    hybrid,
    emergency,
    liquidity: breakdown([
      ...held.map((h) => ({
        label:
          h.instrument.kind === 'cash'
            ? 'Bank / cash'
            : ['ppf', 'epf', 'eps'].includes(h.instrument.kind)
              ? 'Retirement / provident funds'
              : ['fd', 'bond', 'sgb'].includes(h.instrument.kind)
                ? 'Term deposits / bonds'
                : ['stock', 'us-stock', 'mf', 'etf'].includes(h.instrument.kind)
                  ? 'Market-linked holdings'
                  : 'Other',
        value: h.value,
      })),
      { label: OWED_TO_YOU, value: loans.owedToYou },
    ]),
    maturities: breakdown(
      held
        .filter((h) => ['fd', 'bond', 'sgb'].includes(h.instrument.kind))
        .map((h) => {
          const maturity = (h.instrument.terms as DepositTerms | BondTerms | undefined)?.maturity;
          const days = maturity ? daysBetween(date, maturity) : NaN;

          return {
            label: !maturity
              ? 'Unclassified'
              : days <= 0
                ? 'Matured / due'
                : days <= 90
                  ? 'Next 90 days'
                  : days <= 365
                    ? '91–365 days'
                    : 'After 1 year',
            value: h.value,
          };
        }),
    ),
  };
}

export function validAllocationTargets(targets: AllocationTargets): boolean {
  const entries = Object.entries(targets);

  return (
    entries.length > 0 &&
    entries.every(
      ([k, v]) =>
        ASSET_CLASSES.includes(k as AssetClass) && Number.isFinite(v) && v >= 0 && v <= 100,
    ) &&
    Math.abs(entries.reduce((n, [, v]) => n + v, 0) - 100) < 0.001
  );
}

const validBand = (band: number) => Number.isFinite(band) && band >= 0 && band <= MAX_BAND;
const validAmount = (amount: number) => Number.isFinite(amount) && amount >= 0;

export function validPlanSettings(s: AllocationPlanSettings): boolean {
  return ['new-money', 'rebalance'].includes(s.mode) && validBand(s.band) && validAmount(s.amount);
}

/**
 * Splits new money across the classes below target without taking any past it. The most
 * underweight classes rise together: each funded class ends at the same fraction of its target.
 */
export function splitNewMoney(
  current: AllocationTargets,
  targets: AllocationTargets,
  amount: number,
): AllocationTargets {
  const parts: AllocationTargets = {};

  if (!(amount > 0)) {
    return parts;
  }

  const funded = ASSET_CLASSES.filter((c) => (targets[c] ?? 0) > 0)
    .map((c) => ({ c, value: Math.max(0, current[c] ?? 0), weight: targets[c]! / 100 }))
    .sort((a, b) => a.value / a.weight - b.value / b.weight);
  let values = 0;
  let weights = 0;

  // Fill classes in order of how far below target they are, until the next one needs nothing.
  // The gaps below target always add up to at least the amount, so the whole amount is placed.
  for (const [i, f] of funded.entries()) {
    values += f.value;
    weights += f.weight;
    const level = (amount + values) / weights;
    const next = funded[i + 1];

    if (!next || level <= next.value / next.weight) {
      for (const g of funded.slice(0, i + 1)) {
        parts[g.c] = Math.max(0, g.weight * level - g.value);
      }

      break;
    }
  }

  return parts;
}

export function rebalancePlan(
  current: AllocationTargets,
  targets: AllocationTargets,
  amount = 0,
  band = DEFAULT_BAND,
) {
  const total = Object.values(current).reduce((n, v) => n + v, 0);
  const valid = validAllocationTargets(targets) && validAmount(amount) && validBand(band);
  const adds = valid ? splitNewMoney(current, targets, amount) : {};
  const rows = valid
    ? ASSET_CLASSES.map((assetClass) => {
        const value = current[assetClass] ?? 0;
        const targetPct = targets[assetClass] ?? 0;
        const targetValue = ((total + amount) * targetPct) / 100;
        const currentShare = share(value, total);
        // Current share − target, as a fraction: 0.03 is 3 points over.
        const drift = currentShare - targetPct / 100;
        const add = adds[assetClass] ?? 0;

        return {
          assetClass,
          value,
          currentShare,
          targetPct,
          targetValue,
          drift,
          // Nothing held, nothing to drift.
          outside: total > 0 && Math.abs(drift) > band / 100 + 1e-9,
          change: targetValue - value,
          add,
          after: share(value + add, total + amount),
        };
      })
    : [];

  return {
    valid,
    total: total + amount,
    drifted: rows.filter((r) => r.outside).length,
    rows,
  };
}

export function validEmergencySettings(s: EmergencySettings): boolean {
  return (
    Number.isFinite(s.monthlyExpenses) &&
    s.monthlyExpenses > 0 &&
    Number.isFinite(s.months) &&
    s.months >= 1 &&
    s.months <= MAX_MONTHS
  );
}

/** How long the money you can reach quickly would last, against the months you want to keep. */
export function emergencyFund(money: EmergencyMoney, settings: EmergencySettings | null) {
  const available = money.cash + money.cashFunds + money.deposits;

  if (!settings || !validEmergencySettings(settings)) {
    return { valid: false, available, target: 0, months: 0, shortfall: 0, spare: 0 };
  }

  const target = settings.monthlyExpenses * settings.months;

  return {
    valid: true,
    available,
    target,
    months: available / settings.monthlyExpenses,
    shortfall: Math.max(0, target - available),
    spare: Math.max(0, available - target),
  };
}
