// SPDX-License-Identifier: AGPL-3.0-only
import { daysBetween, type ISODate } from '../util/dates.ts';

/** Money going in is negative; money coming out is positive. */
export interface Flow {
  date: ISODate;
  amount: number;
}

/** Excel's XIRR: the annual rate r where Σ amount / (1 + r)^(days / 365) = 0. Null without a root. */
export function xirr(flows: readonly Flow[]): number | null {
  const live = flows.filter((f) => f.amount !== 0);
  if (!live.some((f) => f.amount < 0) || !live.some((f) => f.amount > 0)) return null;
  const start = live.reduce((min, f) => (f.date < min ? f.date : min), live[0]!.date);
  const terms = live.map((f) => ({ t: daysBetween(start, f.date) / 365, a: f.amount }));

  const npv = (r: number) => terms.reduce((sum, { t, a }) => sum + a / (1 + r) ** t, 0);
  const slope = (r: number) =>
    terms.reduce((sum, { t, a }) => sum - (t * a) / (1 + r) ** (t + 1), 0);
  const scale = terms.reduce((m, { a }) => Math.max(m, Math.abs(a)), 0);
  const tolerance = 1e-10 * scale;

  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const value = npv(r);
    if (Math.abs(value) < tolerance) return r;
    const d = slope(r);
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - value / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }
  return bisect(npv, tolerance);
}

function bisect(npv: (r: number) => number, tolerance: number): number | null {
  let lo = -0.999999;
  let hi = 1;
  while (Math.sign(npv(lo)) === Math.sign(npv(hi)) && hi < 1e6) hi *= 10;
  let fLo = npv(lo);
  if (Math.sign(fLo) === Math.sign(npv(hi))) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < tolerance || hi - lo < 1e-12) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}
