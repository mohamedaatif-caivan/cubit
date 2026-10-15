import { Rational } from './rational';
import type { Unit } from './units';

/**
 * A calculated value: an exact rational amount in SI base units plus its dimension
 * (0 = plain number, 1 = length, 2 = area, 3 = volume).
 * `exact` is false only when an irrational step (√ of a non-square, π) was approximated to 40+ digits.
 */
export interface Quantity {
  readonly si: Rational;
  readonly power: number;
  readonly exact: boolean;
}

export const MaxPower = 3;

export const quantity = (si: Rational, power: number, exact = true): Quantity => ({ si, power, exact });

export const Quantity = {
  number: (value: Rational): Quantity => quantity(value, 0),
  of: (amount: Rational, unit: Unit): Quantity => quantity(amount.mul(unit.toSi), unit.power),

  isNumber: (q: Quantity): boolean => q.power === 0,

  /** The exact amount of this quantity expressed in `unit`. */
  in(q: Quantity, unit: Unit): Rational {
    if (unit.power !== q.power) throw new Error(`Cannot express ${Quantity.withArticle(q.power)} in ${unit.name}.`);
    return q.si.div(unit.toSi);
  },

  equals: (a: Quantity, b: Quantity): boolean => a.si.equals(b.si) && a.power === b.power && a.exact === b.exact,

  describe(power: number): string {
    switch (power) {
      case 0:
        return 'plain number';
      case 1:
        return 'length';
      case 2:
        return 'area';
      case 3:
        return 'volume';
      default:
        return `length^${power}`;
    }
  },

  /** "a length", "an area", … */
  withArticle(power: number, capital = false): string {
    return (power === 2 ? (capital ? 'An ' : 'an ') : capital ? 'A ' : 'a ') + Quantity.describe(power);
  },
};

