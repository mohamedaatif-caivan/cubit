import { Rational } from './rational';

export type UnitSystem = 'Metric' | 'Imperial';

/**
 * A unit of length, area or volume. `toSi` is the exact number of SI base units (m, m², m³) in one
 * of this unit. `power` is 1 for length, 2 for area, 3 for volume.
 */
export class Unit {
  constructor(
    readonly id: string,
    readonly symbol: string,
    readonly name: string,
    readonly power: number,
    readonly system: UnitSystem,
    readonly toSi: Rational,
    readonly aliases: readonly string[],
  ) {}

  toString(): string {
    return this.symbol;
  }
}

const D = (exactDecimal: string): Rational => Rational.parse(exactDecimal);

/*
 * The unit catalogue. Every factor is written out as its exact legal definition in SI so it can be
 * audited against the source; the test suite cross-checks each one against the others
 * (12 in = 1 ft, 43,560 ft² = 1 acre, 27 ft³ = 1 yd³, 231 in³ = 1 gal, …).
 *
 * Imperial lengths follow the International Yard and Pound Agreement (1959), as published in
 * NIST SP 811 and NIST Handbook 44: 1 in = 25.4 mm exactly. The acre is the international acre
 * (43,560 international ft²). The gallon is the US liquid gallon (231 in³).
 */

// Length (SI base: metre)
const Millimeter = new Unit('mm', 'mm', 'millimetres', 1, 'Metric', D('0.001'), ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']);
const Centimeter = new Unit('cm', 'cm', 'centimetres', 1, 'Metric', D('0.01'), ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']);
const Meter = new Unit('m', 'm', 'metres', 1, 'Metric', D('1'), ['m', 'meter', 'meters', 'metre', 'metres']);
const Kilometer = new Unit('km', 'km', 'kilometres', 1, 'Metric', D('1000'), ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres']);
const Inch = new Unit('in', 'in', 'inches', 1, 'Imperial', D('0.0254'), ['"', '″', '”', '“', 'in', 'inch', 'inches']);
const Foot = new Unit('ft', 'ft', 'feet', 1, 'Imperial', D('0.3048'), ["'", '′', '’', '‘', 'ft', 'foot', 'feet']);
const Yard = new Unit('yd', 'yd', 'yards', 1, 'Imperial', D('0.9144'), ['yd', 'yds', 'yard', 'yards']);
const Mile = new Unit('mi', 'mi', 'miles', 1, 'Imperial', D('1609.344'), ['mi', 'mile', 'miles']);

// Area (SI base: square metre)
const SquareMillimeter = new Unit('mm2', 'mm²', 'square millimetres', 2, 'Metric', D('0.000001'), ['mm2', 'mm²', 'sqmm']);
const SquareCentimeter = new Unit('cm2', 'cm²', 'square centimetres', 2, 'Metric', D('0.0001'), ['cm2', 'cm²', 'sqcm']);
const SquareMeter = new Unit('m2', 'm²', 'square metres', 2, 'Metric', D('1'), ['m2', 'm²', 'sqm']);
const Hectare = new Unit('ha', 'ha', 'hectares', 2, 'Metric', D('10000'), ['ha', 'hectare', 'hectares']);
const SquareInch = new Unit('in2', 'in²', 'square inches', 2, 'Imperial', D('0.00064516'), ['in2', 'in²', 'sqin']);
const SquareFoot = new Unit('ft2', 'ft²', 'square feet', 2, 'Imperial', D('0.09290304'), ['ft2', 'ft²', 'sqft', 'sf']);
const SquareYard = new Unit('yd2', 'yd²', 'square yards', 2, 'Imperial', D('0.83612736'), ['yd2', 'yd²', 'sqyd', 'sy']);
const Acre = new Unit('ac', 'ac', 'acres', 2, 'Imperial', D('4046.8564224'), ['ac', 'acre', 'acres']);

// Volume (SI base: cubic metre)
const CubicCentimeter = new Unit('cm3', 'cm³', 'cubic centimetres', 3, 'Metric', D('0.000001'), ['cm3', 'cm³', 'cc']);
const Liter = new Unit('L', 'L', 'litres', 3, 'Metric', D('0.001'), ['l', 'liter', 'liters', 'litre', 'litres']);
const CubicMeter = new Unit('m3', 'm³', 'cubic metres', 3, 'Metric', D('1'), ['m3', 'm³', 'cbm']);
const CubicInch = new Unit('in3', 'in³', 'cubic inches', 3, 'Imperial', D('0.000016387064'), ['in3', 'in³', 'cuin']);
const CubicFoot = new Unit('ft3', 'ft³', 'cubic feet', 3, 'Imperial', D('0.028316846592'), ['ft3', 'ft³', 'cuft', 'cf']);
const CubicYard = new Unit('yd3', 'yd³', 'cubic yards', 3, 'Imperial', D('0.764554857984'), ['yd3', 'yd³', 'cuyd', 'cy']);
const UsGallon = new Unit('gal', 'gal', 'US gallons', 3, 'Imperial', D('0.003785411784'), ['gal', 'gallon', 'gallons']);

const All: readonly Unit[] = [
  Millimeter, Centimeter, Meter, Kilometer, Inch, Foot, Yard, Mile,
  SquareMillimeter, SquareCentimeter, SquareMeter, Hectare, SquareInch, SquareFoot, SquareYard, Acre,
  CubicCentimeter, Liter, CubicMeter, CubicInch, CubicFoot, CubicYard, UsGallon,
];

const byAlias = new Map<string, Unit>();
for (const unit of All)
  for (const alias of unit.aliases) {
    const key = alias.toLowerCase();
    if (byAlias.has(key)) throw new Error(`Unit alias '${alias}' is defined twice.`);
    byAlias.set(key, unit);
  }

export const Units = {
  Millimeter, Centimeter, Meter, Kilometer, Inch, Foot, Yard, Mile,
  SquareMillimeter, SquareCentimeter, SquareMeter, Hectare, SquareInch, SquareFoot, SquareYard, Acre,
  CubicCentimeter, Liter, CubicMeter, CubicInch, CubicFoot, CubicYard, UsGallon,
  All,

  /** The unit with this alias (case-insensitive), or undefined. */
  find(alias: string): Unit | undefined {
    return byAlias.get(alias.toLowerCase());
  },

  byId(id: string): Unit {
    const unit = All.find((u) => u.id === id);
    if (!unit) throw new Error(`Unknown unit id '${id}'.`);
    return unit;
  },

  /** The area or volume unit made by squaring/cubing a length unit ("sq ft", "cu yd"), if Cubit has one. */
  raise(length: Unit, power: number): Unit | undefined {
    if (length.power !== 1) return undefined;
    const target = length.toSi.pow(power);
    return All.find((u) => u.power === power && u.toSi.equals(target) && u.id.startsWith(length.id));
  },
};
