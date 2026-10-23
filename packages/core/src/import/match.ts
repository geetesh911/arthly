// SPDX-License-Identifier: AGPL-3.0-only
// Linking a file's instruments to known ones: by ISIN or AMFI code first, then by name.
import { all, type State } from '../log/replay.ts';
import { defaultAssetClass } from '../model/classify.ts';
import { instrumentId, normaliseName } from '../model/ids.ts';
import type { Instrument, InstrumentIds } from '../model/types.ts';

import type { AmfiScheme, InstrumentDraft } from './types.ts';

export type MatchHow = 'existing-id' | 'existing-name' | 'amfi' | 'new' | 'unmatched';

export interface InstrumentMatch {
  ref: string;
  instrument: Instrument;
  existing: boolean;
  how: MatchHow;
  score?: number;
  /** A match by fund name, which the user confirms. */
  confirm: boolean;
}

const STOP_WORDS = new Set(['fund', 'plan', 'option', 'the', 'of', 'and', '&', '-', 'scheme']);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

/** Token Jaccard similarity. */
export function similarity(a: string, b: string): number {
  const x = new Set(nameTokens(a));
  const y = new Set(nameTokens(b));
  let hit = 0;

  for (const t of x) {
    if (y.has(t)) {
      hit += 1;
    }
  }

  const union = x.size + y.size - hit;

  return union === 0 ? 0 : hit / union;
}

/** The AMFI scheme for a fund name: same Direct/Regular plan, growth unless named otherwise, most words in common. */
export function bestAmfiMatch(
  name: string,
  schemes: readonly AmfiScheme[],
): { scheme: AmfiScheme; score: number } | null {
  const direct = /\bdirect\b/i.test(name);
  const growth = !/idcw|dividend/i.test(name);
  let best: { scheme: AmfiScheme; score: number } | null = null;

  for (const scheme of schemes) {
    const lc = scheme.name.toLowerCase();

    if (direct !== /\bdirect\b/.test(lc)) {
      continue;
    }

    if (growth && /idcw|dividend|bonus/.test(lc)) {
      continue;
    }

    const score = similarity(name, scheme.name);

    if (!best || score > best.score) {
      best = { scheme, score };
    }
  }

  return best && best.score >= 0.6 ? best : null;
}

function sameId(a: InstrumentIds, b: InstrumentIds): boolean {
  const eq = (x?: string, y?: string) => !!x && !!y && x.toUpperCase() === y.toUpperCase();

  return (
    eq(a.isin, b.isin) ||
    eq(a.amfi, b.amfi) ||
    eq(a.nse, b.nse) ||
    eq(a.bse, b.bse) ||
    eq(a.us, b.us)
  );
}

function fresh(d: InstrumentDraft, ids: InstrumentIds): Instrument {
  return {
    id: instrumentId(ids, d.name),
    kind: d.kind,
    name: d.name,
    currency: d.currency,
    assetClass: d.assetClass ?? defaultAssetClass(d.kind, d.name, d.hints?.category),
    ids,
    ...(d.terms ? { terms: d.terms } : {}),
  };
}

export function matchInstruments(
  state: State,
  drafts: readonly InstrumentDraft[],
  amfi: readonly AmfiScheme[] = [],
  /** Draft refs whose fund-name match the user turned down. */
  rejected: ReadonlySet<string> = new Set(),
): InstrumentMatch[] {
  const known = all(state, 'instrument');

  return drafts.map((d): InstrumentMatch => {
    const hasIds = Object.values(d.ids).some(Boolean);

    if (hasIds) {
      const byId = known.find((i) => sameId(i.ids, d.ids));

      if (byId) {
        return { ref: d.ref, instrument: byId, existing: true, how: 'existing-id', confirm: false };
      }
    }

    const byName = known.find(
      (i) => i.kind === d.kind && normaliseName(i.name) === normaliseName(d.name),
    );

    if (byName) {
      return {
        ref: d.ref,
        instrument: byName,
        existing: true,
        how: 'existing-name',
        confirm: false,
      };
    }

    if (!hasIds && d.kind === 'mf') {
      const best = rejected.has(d.ref) ? null : bestAmfiMatch(d.name, amfi);

      if (best) {
        const ids: InstrumentIds = {
          amfi: best.scheme.code,
          ...(best.scheme.isinGrowth ? { isin: best.scheme.isinGrowth } : {}),
        };
        const existing = known.find((i) => sameId(i.ids, ids));

        return existing
          ? {
              ref: d.ref,
              instrument: existing,
              existing: true,
              how: 'amfi',
              score: best.score,
              confirm: true,
            }
          : {
              ref: d.ref,
              instrument: fresh(d, ids),
              existing: false,
              how: 'amfi',
              score: best.score,
              confirm: true,
            };
      }

      return {
        ref: d.ref,
        instrument: fresh(d, {}),
        existing: false,
        how: 'unmatched',
        confirm: false,
      };
    }

    return { ref: d.ref, instrument: fresh(d, d.ids), existing: false, how: 'new', confirm: false };
  });
}
