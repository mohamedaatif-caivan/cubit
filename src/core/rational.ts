/** How a value is snapped to an increment. */
export enum RoundingMode {
  /** Closest multiple; exact halves move away from zero. */
  Nearest = 'Nearest',
  /** Mathematical ceiling: toward positive infinity, also for negative values. */
  Up = 'Up',
  /** Mathematical floor: toward negative infinity, also for negative values. */
  Down = 'Down',
}

/** Thrown for a zero divisor; the engine reports it as "Divide by zero". */
export class DivideByZeroError extends Error {
  constructor() {
    super('Division by zero.');
  }
}

const absBig = (n: bigint): bigint => (n < 0n ? -n : n);

function gcd(a: bigint, b: bigint): bigint {
  a = absBig(a);
  b = absBig(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

const isDigits = (s: string): boolean => /^[0-9]+$/.test(s);

/**
 * An exact rational number (bigint numerator over a positive bigint denominator, always reduced).
 * Every calculation in Cubit runs on this type, so binary floating-point error can never enter a result.
 */
export class Rational {
  private constructor(
    readonly num: bigint,
    readonly den: bigint,
  ) {}

  static readonly Zero = new Rational(0n, 1n);
  static readonly One = new Rational(1n, 1n);

  static create(numerator: bigint, denominator: bigint): Rational {
    if (denominator === 0n) throw new DivideByZeroError();
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    const g = gcd(numerator, denominator);
    if (g !== 1n && g !== 0n) {
      numerator /= g;
      denominator /= g;
    }
    return new Rational(numerator, numerator === 0n ? 1n : denominator);
  }

  static of(value: bigint | number): Rational {
    return new Rational(BigInt(value), 1n);
  }

  get numerator(): bigint {
    return this.num;
  }
  get denominator(): bigint {
    return this.den;
  }
  get sign(): number {
    return this.num > 0n ? 1 : this.num < 0n ? -1 : 0;
  }
  get isZero(): boolean {
    return this.num === 0n;
  }
  get isInteger(): boolean {
    return this.den === 1n;
  }

  abs(): Rational {
    return this.num < 0n ? this.neg() : this;
  }
  neg(): Rational {
    return new Rational(-this.num, this.den);
  }
  add(b: Rational): Rational {
    return Rational.create(this.num * b.den + b.num * this.den, this.den * b.den);
  }
  sub(b: Rational): Rational {
    return Rational.create(this.num * b.den - b.num * this.den, this.den * b.den);
  }
  mul(b: Rational): Rational {
    return Rational.create(this.num * b.num, this.den * b.den);
  }
  div(b: Rational): Rational {
    if (b.isZero) throw new DivideByZeroError();
    return Rational.create(this.num * b.den, this.den * b.num);
  }

  equals(other: Rational): boolean {
    return this.num === other.num && this.den === other.den;
  }
  compare(other: Rational): number {
    const l = this.num * other.den;
    const r = other.num * this.den;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  lt(o: Rational): boolean {
    return this.compare(o) < 0;
  }
  gt(o: Rational): boolean {
    return this.compare(o) > 0;
  }
  le(o: Rational): boolean {
    return this.compare(o) <= 0;
  }
  ge(o: Rational): boolean {
    return this.compare(o) >= 0;
  }

  /** Largest integer ≤ this value. */
  floor(): bigint {
    const q = this.num / this.den; // truncates toward zero
    const r = this.num % this.den;
    return r < 0n ? q - 1n : q;
  }

  /** Smallest integer ≥ this value. */
  ceiling(): bigint {
    const q = this.num / this.den;
    const r = this.num % this.den;
    return r > 0n ? q + 1n : q;
  }

  /** Nearest integer; exact halves round away from zero. */
  roundHalfAwayFromZero(): bigint {
    const half = Rational.create(1n, 2n);
    return this.sign >= 0 ? this.add(half).floor() : -this.neg().add(half).floor();
  }

  /** Snaps this value to a whole multiple of `step`. */
  roundToMultiple(step: Rational, mode: RoundingMode): Rational {
    if (step.sign <= 0) throw new RangeError('Increment must be positive.');
    const k = this.div(step);
    const count = mode === RoundingMode.Up ? k.ceiling() : mode === RoundingMode.Down ? k.floor() : k.roundHalfAwayFromZero();
    return Rational.of(count).mul(step);
  }

  pow(exponent: number): Rational {
    if (exponent < 0) return Rational.One.div(this.pow(-exponent));
    const e = BigInt(exponent);
    return Rational.create(this.num ** e, this.den ** e);
  }

  static powerOfTen(exponent: number): Rational {
    return exponent >= 0 ? Rational.of(10n ** BigInt(exponent)) : Rational.create(1n, 10n ** BigInt(-exponent));
  }

  /**
   * Square root. Exact when the value is a perfect square of a rational; otherwise truncated to
   * `digits` decimal places (error below 10^-digits) and reported as inexact.
   */
  static sqrt(value: Rational, digits = 40): { value: Rational; exact: boolean } {
    if (value.sign < 0) throw new RangeError('Square root of a negative value.');
    const product = value.num * value.den; // sqrt(p/q) = sqrt(p·q)/q
    const root = Rational.integerSqrt(product);
    if (root * root === product) return { value: Rational.create(root, value.den), exact: true };
    const scale = 10n ** BigInt(digits);
    return { value: Rational.create(Rational.integerSqrt(product * scale * scale), value.den * scale), exact: false };
  }

  /** ⌊√n⌋ for n ≥ 0 using Newton's method on integers. */
  static integerSqrt(n: bigint): bigint {
    if (n < 0n) throw new RangeError('Square root of a negative value.');
    if (n < 2n) return n;
    const bits = BigInt(n.toString(2).length);
    let x = 1n << ((bits + 1n) / 2n);
    for (;;) {
      const y = (x + n / x) >> 1n;
      if (y >= x) return x;
      x = y;
    }
  }

  /** Parses an exact decimal literal such as "12", "0.3048", ".5", "-1.25" or a fraction "3/8". */
  static parse(text: string): Rational {
    const value = Rational.tryParse(text);
    if (value === null) throw new SyntaxError(`Not a decimal number: '${text}'.`);
    return value;
  }

  static tryParse(text: string): Rational | null {
    let s = text.trim();
    let negative = false;
    if (s.startsWith('-')) {
      negative = true;
      s = s.slice(1);
    } else if (s.startsWith('+')) s = s.slice(1);
    if (s.includes('/')) {
      const parts = s.split('/');
      if (parts.length !== 2 || !isDigits(parts[0]) || !isDigits(parts[1])) return null;
      const d = BigInt(parts[1]);
      if (d === 0n) return null;
      const value = Rational.create(BigInt(parts[0]), d);
      return negative ? value.neg() : value;
    }
    const dot = s.indexOf('.');
    const whole = dot < 0 ? s : s.slice(0, dot);
    const fraction = dot < 0 ? '' : s.slice(dot + 1);
    if (whole.length === 0 && fraction.length === 0) return null;
    if ((whole.length > 0 && !isDigits(whole)) || (fraction.length > 0 && !isDigits(fraction))) return null;
    const digits = BigInt((whole.length === 0 ? '0' : whole) + fraction);
    const value = Rational.create(digits, 10n ** BigInt(fraction.length));
    return negative ? value.neg() : value;
  }

  /**
   * Fixed-point decimal text with exactly `places` decimals, rounded with `mode`.
   * Uses integer arithmetic only.
   */
  toFixed(places: number, mode: RoundingMode = RoundingMode.Nearest, groupThousands = false): string {
    const scaled = this.roundToMultiple(Rational.powerOfTen(-places), mode).mul(Rational.powerOfTen(places)); // an integer now
    const n = scaled.num;
    const negative = n < 0n;
    const digits = absBig(n).toString().padStart(places + 1, '0');
    let whole = places === 0 ? digits : digits.slice(0, digits.length - places);
    if (groupThousands) whole = group(whole);
    let out = negative ? '-' : '';
    out += whole;
    if (places > 0) out += '.' + digits.slice(digits.length - places);
    return out;
  }

  /** Canonical "n" or "n/d" form, used for storage and diagnostics. */
  toString(): string {
    return this.isInteger ? this.num.toString() : `${this.num}/${this.den}`;
  }

  /** π to 60 significant digits. Any result that uses it is marked inexact. */
  static readonly Pi = Rational.parse('3.14159265358979323846264338327950288419716939937510582097494');
}

function group(digits: string): string {
  if (digits.length <= 3) return digits;
  const first = digits.length % 3;
  const parts: string[] = [];
  if (first > 0) parts.push(digits.slice(0, first));
  for (let i = first; i < digits.length; i += 3) parts.push(digits.slice(i, i + 3));
  return parts.join(',');
}

/** Shorthand for an exact value from an integer or an exact decimal string. */
export const R = (value: number | bigint | string): Rational =>
  typeof value === 'string' ? Rational.parse(value) : Rational.of(value);
