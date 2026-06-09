// packages/shared/src/utils/validation.ts
import { money } from './decimal';

export function requireDecimalString(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a decimal string`);
  }
  const parsed = money(value);
  if (!parsed.isFinite()) {
    throw new Error(`${field} must be finite`);
  }
  return parsed.toFixed();
}

export function requireSymbol(symbol: string): string {
  if (!/^[A-Z0-9]{2,12}-[A-Z0-9]{2,12}$/.test(symbol)) {
    throw new Error('symbol must be formatted as BASE-QUOTE');
  }
  return symbol;
}
