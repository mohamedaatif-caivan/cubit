import { Rational, RoundingMode } from './rational';
import { DisplayFormat, FormatStyle } from './formats';
import { Quantity } from './quantity';

/**
 * `text`: what to show or copy.
 * `shown`: the exact value the text represents, in the format's unit (inches for fractional formats).
 * `isExact`: true when `text` equals the true result with no rounding.
 * `number`: the text without a unit symbol for decimal formats ("1676.4" for "1676.4 mm"), for pasting
 * into Excel and CAD. Feet-inches and fractional inches keep their ' and " marks because they're part of the number.
 */
export interface FormattedValue {
  readonly text: string;
  readonly shown: Rational;
  readonly isExact: boolean;
  readonly number: string;
}

const TWELVE = Rational.of(12);

/**
 * Formats quantities. Rounding is applied once, to the total in the format's unit (total inches for
 * feet-and-inches), and only then split into feet, inches and a reduced fraction, so carries across
 * inch and foot boundaries are always correct (11 15/16" rounded up to 1" is 1'-0").
 */
export const Formatter = {
  /** The rounding step: 1/precision inch for fractional formats, 10^-precision units otherwise. */
  increment(format: DisplayFormat, precision: number): Rational {
    return format.isFractional ? Rational.create(1n, BigInt(precision)) : Rational.powerOfTen(-precision);
  },

  format(q: Quantity, format: DisplayFormat, precision: number, mode: RoundingMode = RoundingMode.Nearest, groupThousands = false): FormattedValue {
    if (q.power !== format.power) throw new Error(`${Quantity.withArticle(q.power, true)} can't be shown as ${format.label}.`);
    if (format.isFractional && (precision < 1 || precision > 1024)) throw new RangeError('Fraction precision must be a denominator from 1 to 1024.');
    if (!format.isFractional && (precision < 0 || precision > 12)) throw new RangeError('Decimal places must be 0 to 12.');
    return formatCore(q, format, Formatter.increment(format, precision), precision, mode, groupThousands);
  },

  /**
   * Formats to any step in the format's unit: 1/4 yd³, 5 mm, 2" (inches for feet-inches). Decimal output
   * shows as many places as the step needs (0.25 → 2, 5 → 0).
   */
  formatStep(q: Quantity, format: DisplayFormat, increment: Rational, mode: RoundingMode = RoundingMode.Nearest, groupThousands = false): FormattedValue {
    if (q.power !== format.power) throw new Error(`${Quantity.withArticle(q.power, true)} can't be shown as ${format.label}.`);
    if (increment.sign <= 0) throw new RangeError('The rounding step must be positive.');
    return formatCore(q, format, increment, Formatter.placesFor(increment), mode, groupThousands);
  },

  /** Decimal places needed to write `increment` exactly (6 if it never terminates). */
  placesFor(increment: Rational): number {
    for (let places = 0; places <= 12; places++) if (increment.mul(Rational.powerOfTen(places)).isInteger) return places;
    return 6;
  },

  /**
   * Construction notation for an inch total already snapped to its increment: 1'-6 5/16", 11", -3 1/2",
   * 1'-0", and 40'-0 5/16" (the 0 is kept after feet so it can't be misread as 40' − 5/16").
   */
  feetInchesText(totalInches: Rational): string {
    const magnitude = totalInches.abs();
    const feet = magnitude.div(TWELVE).floor();
    const inches = magnitude.sub(Rational.of(feet * 12n));
    let out = totalInches.sign < 0 ? '-' : '';
    if (feet !== 0n) out += `${feet}'-`;
    return out + inchesPart(inches, feet !== 0n);
  },

  /** Inches only: 18 5/16", 5/16", -2 1/4". */
  inchesText(totalInches: Rational): string {
    return (totalInches.sign < 0 ? '-' : '') + inchesPart(totalInches.abs(), false);
  },

  /** The exact value as a fraction of the unit, for audit views: "5000/127 in". */
  exactText(q: Quantity, format: DisplayFormat): string {
    const value = format.unit === null ? q.si : Quantity.in(q, format.unit);
    if (value.isInteger) return value.toString();
    const whole = value.numerator / value.denominator; // truncates toward zero
    const rest = value.sub(Rational.of(whole)).abs();
    return whole === 0n ? value.toString() : `${whole} ${rest}`;
  },
};

function formatCore(q: Quantity, format: DisplayFormat, increment: Rational, places: number, mode: RoundingMode, groupThousands: boolean): FormattedValue {
  const value = format.unit === null ? q.si : Quantity.in(q, format.unit);
  const shown = value.roundToMultiple(increment, mode);
  const exact = q.exact && shown.equals(value);
  let number: string;
  switch (format.style) {
    case FormatStyle.FeetInches:
      number = Formatter.feetInchesText(shown);
      break;
    case FormatStyle.FractionalInches:
      number = Formatter.inchesText(shown);
      break;
    case FormatStyle.Number:
      number = numberText(shown, places, groupThousands);
      break;
    default:
      number = shown.toFixed(places, mode, groupThousands);
  }
  const text = format.style === FormatStyle.Decimal ? `${number} ${format.unit!.symbol}` : number;
  return { text, shown, isExact: exact, number };
}

function inchesPart(inches: Rational, keepZero: boolean): string {
  const whole = inches.floor();
  const fraction = inches.sub(Rational.of(whole));
  let out: string;
  if (fraction.isZero) out = whole.toString();
  else out = (whole !== 0n || keepZero ? `${whole} ` : '') + `${fraction.numerator}/${fraction.denominator}`;
  return out + '"';
}

/** Plain numbers drop trailing zeros: 2.5, 12, 0.333333. */
function numberText(shown: Rational, places: number, group: boolean): string {
  let text = shown.toFixed(places, RoundingMode.Nearest, group);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}
