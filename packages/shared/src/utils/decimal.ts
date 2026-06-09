// packages/shared/src/utils/decimal.ts
import Decimal from 'decimal.js';

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -30,
  toExpPos: 40
});

export function money(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

export function add(a: string, b: string): string {
  return money(a).plus(b).toFixed();
}

export function subtract(a: string, b: string): string {
  return money(a).minus(b).toFixed();
}

export function multiply(a: string, b: string): string {
  return money(a).mul(b).toFixed();
}

export function divide(a: string, b: string): string {
  return money(a).div(b).toFixed();
}

export function isPositive(value: string): boolean {
  return money(value).gt(0);
}

export function assertNonNegative(value: string, label: string): void {
  if (money(value).lt(0)) {
    throw new Error(`${label} must be non-negative`);
  }
}
