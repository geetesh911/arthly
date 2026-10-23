// SPDX-License-Identifier: AGPL-3.0-only
// Dates are ISO `YYYY-MM-DD` strings with no time zone. Maths runs on UTC midnights.
export type ISODate = string;

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(text: string): boolean {
  const m = ISO.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function parts(date: ISODate): [number, number, number] {
  const m = ISO.exec(date);
  if (!m) throw new Error(`Not an ISO date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function makeDate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toMs(date: ISODate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

export function fromMs(ms: number): ISODate {
  const d = new Date(ms);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Today's local date on this device. */
export function today(now: Date = new Date()): ISODate {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromMs(toMs(date) + days * DAY_MS);
}

/** Adds calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return makeDate(year, month, Math.min(d, daysInMonth(year, month)));
}

export function addYears(date: ISODate, years: number): ISODate {
  return addMonths(date, years * 12);
}

/** Weekdays from `from` back, newest first; exchanges publish nothing at weekends. */
export function weekdaysBack(from: ISODate, count: number): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; out.length < count; d = addDays(d, -1)) {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) out.push(d);
  }
  return out;
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

export const year = (date: ISODate): number => parts(date)[0];
export const month = (date: ISODate): number => parts(date)[1];
export const day = (date: ISODate): number => parts(date)[2];

export function endOfMonth(date: ISODate): ISODate {
  const [y, m] = parts(date);
  return makeDate(y, m, daysInMonth(y, m));
}

export const minDate = (a: ISODate, b: ISODate): ISODate => (a < b ? a : b);
export const maxDate = (a: ISODate, b: ISODate): ISODate => (a > b ? a : b);

/** Financial year (April to March), named by its starting year: 2026-05-01 → 2026. */
export function fyOf(date: ISODate): number {
  const [y, m] = parts(date);
  return m >= 4 ? y : y - 1;
}

export const fyStart = (fy: number): ISODate => makeDate(fy, 4, 1);
export const fyEnd = (fy: number): ISODate => makeDate(fy + 1, 3, 31);

/** "2026-27" */
export function fyLabel(fy: number): string {
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}
