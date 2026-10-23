// SPDX-License-Identifier: AGPL-3.0-only
function roundTo(value: number, places: number): number {
  const factor = 10 ** places;

  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
}

export const roundAmount = (value: number): number => roundTo(value, 2);
export const roundUnits = (value: number): number => roundTo(value, 6);
export const roundPrice = (value: number): number => roundTo(value, 4);
/** A rate as a fraction, to a hundredth of a basis point. */
export const roundRate = (value: number): number => roundTo(value, 6);

/** True when a and b differ by no more than tolerance. */
export function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** The value tolerance used by reconciliation checks: max(₹100, 0.05%). */
export function valueTolerance(value: number): number {
  return Math.max(100, Math.abs(value) * 0.0005);
}
