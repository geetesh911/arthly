// SPDX-License-Identifier: AGPL-3.0-only
// Indian number formatting: ₹1,23,456.
const whole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const signed = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});
const compact = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const unitsFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : whole.format(n);
export const inrExact = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : exact.format(n);
/** A gain or loss: +₹1,200, -₹300 or ₹0. */
export const inrSigned = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : signed.format(n);

/** ₹12.3 L, ₹1.2 Cr */
export function inrShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${compact.format(n / 1e7)} Cr`;
  if (abs >= 1e5) return `₹${compact.format(n / 1e5)} L`;
  return whole.format(n);
}

/** 7.89%, or +7.89% with `sign`. A tiny loss shows as 0.00%, not -0.00%. */
export function pct(n: number | null | undefined, digits = 2, sign = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: sign ? 'exceptZero' : 'negative',
  }).format(n);
}

export const units = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : unitsFmt.format(n);

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
export const date = (iso: string | undefined) =>
  iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—';

const dayFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
/** 21 Oct, with the year only when it isn't this year. */
export const shortDate = (iso: string, now = new Date()) =>
  iso.startsWith(String(now.getFullYear()))
    ? dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))
    : date(iso);

export const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;

export const CLASS_NAMES: Record<string, string> = {
  equity: 'Equity',
  debt: 'Debt',
  hybrid: 'Hybrid',
  gold: 'Gold',
  silver: 'Silver',
  cash: 'Cash',
  other: 'Other',
};
