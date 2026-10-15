import { describe, expect, it } from 'vitest';
import { R, Rational, RoundingMode } from '../src/core/rational';

/** Port of RationalTests.cs. */
const F = (n: number, d: number): Rational => Rational.create(BigInt(n), BigInt(d));

describe('Rational', () => {
  it('arithmetic is exact', () => {
    expect(Rational.parse('0.1').add(Rational.parse('0.2'))).toEqual(F(3, 10)); // 0.30000000000000004 in binary floating point
    expect(F(1, 3).mul(R(3))).toEqual(Rational.One);
    expect(Rational.One.div(R(7))).toEqual(F(1, 7));
    expect(F(10, -4)).toEqual(F(-5, 2));
  });

  it.each([
    [7, 2, 3, 4],
    [-7, 2, -4, -3],
    [6, 3, 2, 2],
    [-6, 3, -2, -2],
  ])('floor and ceiling of %i/%i are mathematical (%i, %i)', (n, d, floor, ceiling) => {
    expect(F(n, d).floor()).toBe(BigInt(floor));
    expect(F(n, d).ceiling()).toBe(BigInt(ceiling));
  });

  it.each([
    [5, 2, 3],
    [-5, 2, -3],
    [7, 3, 2],
    [-7, 3, -2],
  ])('halves round away from zero: %i/%i -> %i', (n, d, expected) => {
    expect(F(n, d).roundHalfAwayFromZero()).toBe(BigInt(expected));
  });

  it.each([
    ['1.23456', 2, '1.23'],
    ['1.235', 2, '1.24'],
    ['-1.235', 2, '-1.24'],
    ['0.05', 1, '0.1'],
    ['1234567.891', 1, '1234567.9'],
    ['12', 0, '12'],
    ['0.0001', 2, '0.00'],
  ])('toFixed(%s, %i) rounds with integer arithmetic to %s', (value, places, expected) => {
    expect(Rational.parse(value).toFixed(places)).toBe(expected);
  });

  it('toFixed groups thousands on request', () => {
    expect(Rational.parse('-1234567.5').toFixed(2, RoundingMode.Nearest, true)).toBe('-1,234,567.50');
  });

  it('square root is exact for perfect squares', () => {
    const { value: root, exact } = Rational.sqrt(F(9, 16));
    expect(exact).toBe(true);
    expect(root).toEqual(F(3, 4));
  });

  it('square root of two is accurate to 40 places', () => {
    const { value: root, exact } = Rational.sqrt(R(2));
    expect(exact).toBe(false);
    expect(root.toFixed(40, RoundingMode.Down)).toBe('1.4142135623730950488016887242096980785696');
    expect(root.mul(root).lt(R(2))).toBe(true);
    const next = root.add(Rational.powerOfTen(-40));
    expect(next.mul(next).gt(R(2))).toBe(true);
  });

  it('pi constant matches published digits', () => {
    expect(Rational.Pi.toFixed(50, RoundingMode.Down)).toBe('3.14159265358979323846264338327950288419716939937510');
  });

  it.each(['0.3048', '.5', '-12.75', '3/16'])('parse accepts exact literal %j', (text) => {
    expect(Rational.tryParse(text)).not.toBeNull();
  });

  it.each(['', '1.2.3', '1/0', 'abc'])('parse rejects malformed text %j', (text) => {
    expect(Rational.tryParse(text)).toBeNull();
  });
});
