// SPDX-License-Identifier: AGPL-3.0-only
export interface Slice {
  label: string;
  value: number;
  share: number;
}
export interface Breakdown {
  total: number;
  classified: number;
  slices: Slice[];
}
export interface ExposureRow {
  key: string;
  name: string;
  value: number;
  invested: number | null;
  gain: number | null;
  share: number;
  portfolioShare: number;
  directValue?: number;
  indirectValue?: number;
}
export interface Concentration {
  total: number;
  count: number;
  top1: number | null;
  top5: number | null;
  effectiveCount: number | null;
  rows: ExposureRow[];
}

export const shareOf = (value: number, total: number) => (total > 0 ? value / total : 0);

export function breakdown(rows: { label: string; value: number }[]): Breakdown {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.label, (map.get(r.label) ?? 0) + r.value);
  const total = rows.reduce((n, r) => n + r.value, 0);
  return {
    total,
    classified: total - (map.get('Unclassified') ?? 0),
    slices: [...map]
      .filter(([, value]) => value > 1e-8)
      .map(([label, value]) => ({ label, value, share: shareOf(value, total) }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
  };
}

export function finishConcentration(input: ExposureRow[], total: number): Concentration {
  const subtotal = input.reduce((n, r) => n + r.value, 0);
  const rows = input
    .map((r) => ({
      ...r,
      share: shareOf(r.value, subtotal),
      portfolioShare: shareOf(r.value, total),
    }))
    .sort((a, b) => b.value - a.value);
  const hhi = rows.reduce((n, r) => n + r.share ** 2, 0);
  return {
    total: subtotal,
    count: rows.length,
    rows,
    top1: rows[0]?.share ?? null,
    top5: subtotal > 0 ? rows.slice(0, 5).reduce((n, r) => n + r.share, 0) : null,
    effectiveCount: hhi > 0 ? 1 / hhi : null,
  };
}
