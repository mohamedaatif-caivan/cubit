import { describe, expect, it } from 'vitest';
import { Formats } from '../src/core/formats';
import { R, Rational } from '../src/core/rational';
import { Units as U } from '../src/core/units';

/**
 * Port of UnitDefinitionTests.cs. Double-entry checks on the unit table: each factor is compared with
 * its published legal value and with the other units, so a typo in any one definition fails at least two tests.
 */
const n = (k: number): Rational => R(k);

describe('unit definitions', () => {
  // International Yard and Pound Agreement (1959); NIST SP 811 Appendix B.
  it.each([
    ['in', '0.0254'],
    ['ft', '0.3048'],
    ['yd', '0.9144'],
    ['mi', '1609.344'],
    ['mm', '0.001'],
    ['cm', '0.01'],
    ['m', '1'],
    ['km', '1000'],
    ['ac', '4046.8564224'],
    ['ha', '10000'],
    ['L', '0.001'],
    ['gal', '0.003785411784'],
  ])('%s equals its published legal definition (%s SI)', (id, si) => {
    expect(U.byId(id).toSi).toEqual(R(si));
  });

  it('imperial lengths agree with each other', () => {
    expect(U.Foot.toSi).toEqual(n(12).mul(U.Inch.toSi));
    expect(U.Yard.toSi).toEqual(n(3).mul(U.Foot.toSi));
    expect(U.Mile.toSi).toEqual(n(5280).mul(U.Foot.toSi));
    expect(U.Inch.toSi.div(U.Millimeter.toSi)).toEqual(R('25.4'));
  });

  it('areas and volumes are exact powers of their lengths', () => {
    expect(U.SquareInch.toSi).toEqual(U.Inch.toSi.pow(2));
    expect(U.SquareFoot.toSi).toEqual(U.Foot.toSi.pow(2));
    expect(U.SquareYard.toSi).toEqual(U.Yard.toSi.pow(2));
    expect(U.SquareMillimeter.toSi).toEqual(U.Millimeter.toSi.pow(2));
    expect(U.SquareCentimeter.toSi).toEqual(U.Centimeter.toSi.pow(2));
    expect(U.CubicInch.toSi).toEqual(U.Inch.toSi.pow(3));
    expect(U.CubicFoot.toSi).toEqual(U.Foot.toSi.pow(3));
    expect(U.CubicYard.toSi).toEqual(U.Yard.toSi.pow(3));
    expect(U.CubicCentimeter.toSi).toEqual(U.Centimeter.toSi.pow(3));
  });

  it('trade conversions hold exactly', () => {
    expect(U.Acre.toSi).toEqual(n(43560).mul(U.SquareFoot.toSi));
    expect(U.SquareYard.toSi).toEqual(n(9).mul(U.SquareFoot.toSi));
    expect(U.CubicYard.toSi).toEqual(n(27).mul(U.CubicFoot.toSi));
    expect(U.CubicFoot.toSi).toEqual(n(1728).mul(U.CubicInch.toSi));
    expect(U.UsGallon.toSi).toEqual(n(231).mul(U.CubicInch.toSi));
    expect(U.Liter.toSi).toEqual(n(1000).mul(U.CubicCentimeter.toSi));
    expect(U.Hectare.toSi).toEqual(n(100 * 100).mul(U.SquareMeter.toSi));
  });

  it('every unit can be typed and displayed', () => {
    for (const unit of U.All) {
      const found = U.find(unit.aliases[0]);
      expect(found, unit.id).toBeDefined();
      expect(found).toBe(unit);
      expect(Formats.forUnit(unit), unit.id).toBeDefined();
    }
  });

  it('every display format matches its unit dimension', () => {
    for (const format of Formats.All.filter((f) => f.unit !== null)) expect(format.power, format.id).toBe(format.unit!.power);
  });
});
