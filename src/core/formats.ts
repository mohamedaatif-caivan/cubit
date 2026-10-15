import { Unit, UnitSystem, Units as U } from './units';

export enum FormatStyle {
  /** 1'-6 5/16" */
  FeetInches = 'FeetInches',
  /** 18 5/16" */
  FractionalInches = 'FractionalInches',
  /** 3.7640 m */
  Decimal = 'Decimal',
  /** A plain number: 2.5 */
  Number = 'Number',
}

/** A way of showing a value, such as feet-and-inches to 1/16" or metres to 4 places. */
export class DisplayFormat {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly style: FormatStyle,
    readonly unit: Unit | null,
    readonly power: number,
    readonly defaultPrecision: number,
  ) {}

  /** True when precision is a fraction denominator (16 = 1/16") rather than decimal places. */
  get isFractional(): boolean {
    return this.style === FormatStyle.FeetInches || this.style === FormatStyle.FractionalInches;
  }

  toString(): string {
    return this.label;
  }
}

const F = (id: string, label: string, style: FormatStyle, unit: Unit | null, power: number, precision: number) =>
  new DisplayFormat(id, label, style, unit, power, precision);

const FeetInches = F('ft-in', 'Feet-inches', FormatStyle.FeetInches, U.Inch, 1, 16);
const Inches = F('in-frac', 'Inches', FormatStyle.FractionalInches, U.Inch, 1, 16);
const DecimalFeet = F('ft', 'Decimal feet', FormatStyle.Decimal, U.Foot, 1, 4);
const DecimalInches = F('in', 'Decimal inches', FormatStyle.Decimal, U.Inch, 1, 3);
const Yards = F('yd', 'Yards', FormatStyle.Decimal, U.Yard, 1, 4);
const Meters = F('m', 'Metres', FormatStyle.Decimal, U.Meter, 1, 4);
const Centimeters = F('cm', 'Centimetres', FormatStyle.Decimal, U.Centimeter, 1, 2);
const Millimeters = F('mm', 'Millimetres', FormatStyle.Decimal, U.Millimeter, 1, 1);

const SquareFeet = F('ft2', 'Square feet', FormatStyle.Decimal, U.SquareFoot, 2, 2);
const SquareInches = F('in2', 'Square inches', FormatStyle.Decimal, U.SquareInch, 2, 2);
const SquareYards = F('yd2', 'Square yards', FormatStyle.Decimal, U.SquareYard, 2, 3);
const SquareMeters = F('m2', 'Square metres', FormatStyle.Decimal, U.SquareMeter, 2, 3);
const Acres = F('ac', 'Acres', FormatStyle.Decimal, U.Acre, 2, 4);
const Hectares = F('ha', 'Hectares', FormatStyle.Decimal, U.Hectare, 2, 4);

const CubicYards = F('yd3', 'Cubic yards', FormatStyle.Decimal, U.CubicYard, 3, 2);
const CubicFeet = F('ft3', 'Cubic feet', FormatStyle.Decimal, U.CubicFoot, 3, 2);
const CubicInches = F('in3', 'Cubic inches', FormatStyle.Decimal, U.CubicInch, 3, 1);
const CubicMeters = F('m3', 'Cubic metres', FormatStyle.Decimal, U.CubicMeter, 3, 3);
const Liters = F('L', 'Litres', FormatStyle.Decimal, U.Liter, 3, 1);
const Gallons = F('gal', 'US gallons', FormatStyle.Decimal, U.UsGallon, 3, 2);

const NumberFormat = F('num', 'Number', FormatStyle.Number, null, 0, 6);

/** Every format, grouped by dimension in the order the result panel shows them. */
const All: readonly DisplayFormat[] = [
  FeetInches, Inches, DecimalFeet, DecimalInches, Yards, Meters, Centimeters, Millimeters,
  SquareFeet, SquareInches, SquareYards, SquareMeters, Acres, Hectares,
  CubicYards, CubicFeet, CubicInches, CubicMeters, Liters, Gallons,
  NumberFormat,
];

export const Formats = {
  FeetInches, Inches, DecimalFeet, DecimalInches, Yards, Meters, Centimeters, Millimeters,
  SquareFeet, SquareInches, SquareYards, SquareMeters, Acres, Hectares,
  CubicYards, CubicFeet, CubicInches, CubicMeters, Liters, Gallons,
  Number: NumberFormat,
  All,

  forPower: (power: number): DisplayFormat[] => All.filter((f) => f.power === power),

  byId: (id: string | null | undefined): DisplayFormat | undefined => All.find((f) => f.id === id),

  /** A catalogue format, or the "to unit" format for any other unit id (km, mi). */
  find(id: string | null | undefined): DisplayFormat | undefined {
    if (id == null) return undefined;
    const known = Formats.byId(id);
    if (known) return known;
    const unit = U.All.find((u) => u.id === id);
    return unit ? Formats.forUnit(unit) : undefined;
  },

  /** The usual format for each dimension in a unit system: m, m², m³ or ft-in, ft², yd³. */
  defaultFor(power: number, system: UnitSystem): DisplayFormat {
    if (system === 'Metric') {
      if (power === 1) return Meters;
      if (power === 2) return SquareMeters;
      if (power === 3) return CubicMeters;
    } else {
      if (power === 1) return FeetInches;
      if (power === 2) return SquareFeet;
      if (power === 3) return CubicYards;
    }
    return NumberFormat;
  },

  /** The format for "… to unit": inches show as fractions, other units as decimals. */
  forUnit(unit: Unit): DisplayFormat | undefined {
    if (unit === U.Inch) return Inches;
    const known = All.find((f) => f.style === FormatStyle.Decimal && f.unit === unit);
    if (known) return known;
    return unit.power >= 1 && unit.power <= 3 ? new DisplayFormat(unit.id, unit.name, FormatStyle.Decimal, unit, unit.power, 4) : undefined;
  },

  Denominators: [1, 2, 4, 8, 16, 32, 64] as readonly number[],
  DecimalPlaces: [0, 1, 2, 3, 4, 5, 6] as readonly number[],
};
