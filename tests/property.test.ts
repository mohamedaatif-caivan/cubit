import { describe, expect, it } from 'vitest';
import { CalcEngine } from '../src/core/calcEngine';
import { Formats } from '../src/core/formats';
import { Formatter } from '../src/core/formatter';
import { Quantity } from '../src/core/quantity';
import { R, Rational, RoundingMode } from '../src/core/rational';
import { Units } from '../src/core/units';

/**
 * Port of PropertyTests.cs. Randomised differential tests: each test builds thousands of inputs and
 * computes the expected answer with a separate, deliberately simple oracle that uses only whole-number
 * (bigint) arithmetic in nanometres (1/64" = 396,875 nm and 1 µm = 1,000 nm exactly). The oracle shares
 * no code with the engine, so the two can only agree if both are right. Seeds are fixed, so every run
 * is identical (the sequence differs from the C# System.Random one; the generation rules are the same).
 */

const Iterations = 3000;
const NmPer64thInch = 396_875n;
const NmPerMicrometre = 1_000n;
const NmPerMetre = 1_000_000_000n;
const Timeout = 120_000;

/** SplitMix64 on bigint: a small, deterministic, integer-only PRNG standing in for System.Random. */
class SeededRandom {
  private state: bigint;
  private static readonly Mask = (1n << 64n) - 1n;

  constructor(seed: number) {
    this.state = BigInt(seed) & SeededRandom.Mask;
  }

  private nextBits(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & SeededRandom.Mask;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & SeededRandom.Mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & SeededRandom.Mask;
    return z ^ (z >> 31n);
  }

  /** Like System.Random.NextInt64(min, max): min ≤ result < max. */
  nextBig(min: bigint, max: bigint): bigint {
    return min + (this.nextBits() % (max - min));
  }

  /** Like System.Random.Next(max) / Next(min, max): min ≤ result < max. */
  next(minOrMax: number, max?: number): number {
    const [lo, hi] = max === undefined ? [0, minOrMax] : [minOrMax, max];
    return Number(this.nextBig(BigInt(lo), BigInt(hi)));
  }

  /** Like System.Random.Next(): a non-negative int. */
  nextAny(): number {
    return this.next(0, 2_147_483_647);
  }
}

const absBig = (n: bigint): bigint => (n < 0n ? -n : n);

function gcd(a: bigint, b: bigint): bigint {
  a = absBig(a);
  b = absBig(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Asserts q.si == numerator / denominator metres (or m², m³) by cross-multiplying integers. */
function assertSi(q: Quantity, numerator: bigint, denominator: bigint, context: string): void {
  const left = q.si.numerator * denominator;
  const right = numerator * q.si.denominator;
  expect(left === right, `${context}\n engine: ${q.si} SI\n oracle: ${numerator}/${denominator} SI`).toBe(true);
}

// ---- Oracle helpers: whole-number arithmetic only ----

/** A random length written in one of the notations people type, and its exact size in nanometres. */
function randomLength(random: SeededRandom, allowNegative = true): [string, bigint] {
  void allowNegative; // as in C#: the generator only produces non-negative lengths either way
  if (random.next(2) === 0) {
    const k = random.nextBig(0n, 1000n * 12n * 64n); // up to 1000 ft, in 1/64"
    return [imperialText(random, k), k * NmPer64thInch];
  }
  const um = random.nextBig(0n, 300_000_000n); // up to 300 m, in micrometres
  let text: string;
  switch (random.next(3)) {
    case 0:
      text = decimalText(um, 1_000n) + (random.next(2) === 0 ? 'mm' : ' mm');
      break;
    case 1:
      text = decimalText(um, 10_000n) + (random.next(2) === 0 ? 'cm' : ' cm');
      break;
    default:
      text = decimalText(um, 1_000_000n) + (random.next(2) === 0 ? 'm' : ' m');
  }
  return [text, um * NmPerMicrometre];
}

function imperialText(random: SeededRandom, k64: bigint): string {
  const feet = k64 / 768n;
  const rest = k64 % 768n;
  const inches = rest / 64n;
  const frac = rest % 64n;
  const fraction = reduced(frac, 64n);
  switch (random.next(6)) {
    case 0: // 5'6 1/2"
      return `${feet}'${inchPart(inches, fraction, ' ')}"`;
    case 1: // 5'-6 1/2" (architectural)
      return `${feet}'-${inchPart(inches, fraction, ' ')}"`;
    case 2: // 5' 6-1/2"
      return `${feet}' ${inchPart(inches, fraction, '-')}"`;
    case 3: // 5 ft 6 1/2 in
      return `${feet} ft ${inchPart(inches, fraction, ' ')} in`;
    case 4: // 66 1/2"
      return `${inchPart(feet * 12n + inches, fraction, ' ')}"`;
    default: // 66.5"
      return decimalText(k64, 64n) + '"';
  }
}

function inchPart(whole: bigint, fraction: [bigint, bigint], joiner: string): string {
  if (fraction[0] === 0n) return whole.toString();
  const f = `${fraction[0]}/${fraction[1]}`;
  return whole === 0n ? f : `${whole}${joiner}${f}`;
}

function reduced(n: bigint, d: bigint): [bigint, bigint] {
  const g = gcd(n, d);
  return g === 0n ? [0n, 1n] : [n / g, d / g];
}

/** Exact decimal text for value / scale, where scale's only prime factors are 2 and 5. */
function decimalText(value: bigint, scale: bigint): string {
  const negative = value < 0n;
  const abs = absBig(value);
  let places = 0;
  while (10n ** BigInt(places) % scale !== 0n) places++;
  const factor = 10n ** BigInt(places) / scale;
  const digits = (abs * factor).toString().padStart(places + 1, '0');
  let text = places === 0 ? digits : digits.slice(0, digits.length - places) + '.' + digits.slice(digits.length - places);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return (negative ? '-' : '') + text;
}

/** Independent feet-inches formatter working in whole units of 1/unitsPerInch". */
function oracleFeetInches(units: bigint, step: bigint, mode: RoundingMode, unitsPerInch = 128n): string {
  let q = units / step; // truncates toward zero
  const r = units % step;
  if (r !== 0n) {
    const floor = r < 0n ? q - 1n : q;
    q =
      mode === RoundingMode.Down
        ? floor
        : mode === RoundingMode.Up
          ? floor + 1n
          : absBig(r) * 2n >= step
            ? units < 0n
              ? q - 1n
              : q + 1n
            : q;
  }
  const total = q * step;
  const abs = absBig(total);
  const perFoot = 12n * unitsPerInch;
  const feet = abs / perFoot;
  const inchUnits = abs % perFoot;
  const inches = inchUnits / unitsPerInch;
  const frac = inchUnits % unitsPerInch;
  let out = '';
  if (total < 0n) out += '-';
  if (feet > 0n) out += `${feet}'-`;
  let inchText = inchPart(inches, reduced(frac, unitsPerInch), ' ');
  if (feet > 0n && inches === 0n && frac !== 0n) inchText = '0 ' + inchText; // 40'-0 5/16"
  out += inchText + '"';
  return out;
}

const WholeUnits: readonly [string, bigint][] = [
  ['mm', 1_000_000n],
  ['cm', 10_000_000n],
  ['m', 1_000_000_000n],
  ['"', 25_400_000n],
  ["'", 304_800_000n],
  [' ft', 304_800_000n],
  ['yd', 914_400_000n],
];

describe('property tests (integer nanometre oracle)', () => {
  it(
    'random mixed-unit sums match the integer oracle',
    () => {
      const random = new SeededRandom(20261007);
      for (let n = 0; n < Iterations; n++) {
        const terms = random.next(1, 7);
        let text = '';
        let totalNm = 0n;
        for (let t = 0; t < terms; t++) {
          const [termText, termNm] = randomLength(random);
          let subtract = t > 0 && random.next(2) === 0;
          if (t > 0) text += subtract ? ' - ' : ' + ';
          else if (random.next(4) === 0) {
            text += '-';
            subtract = true;
          }
          text += termText;
          totalNm += subtract ? -termNm : termNm;
        }
        let input = text;
        let multiplier = 1n;
        let divisor = 1n;
        switch (random.next(3)) {
          case 1:
            multiplier = BigInt(random.next(2, 13));
            input = `(${input}) * ${multiplier}`;
            break;
          case 2:
            divisor = BigInt(random.next(2, 17));
            input = `(${input}) / ${divisor}`;
            break;
        }
        const result = CalcEngine.evaluate(input);
        expect(result.value, `#${n} '${input}' failed: ${result.error}`).not.toBeNull();
        expect(result.value!.power).toBe(1);
        assertSi(result.value!, totalNm * multiplier, NmPerMetre * divisor, `#${n} '${input}'`);
      }
    },
    Timeout,
  );

  it(
    'plain numbers in a one-unit sum take that unit',
    () => {
      const random = new SeededRandom(20261008);
      for (let n = 0; n < Iterations; n++) {
        const [unit, nm] = WholeUnits[random.next(WholeUnits.length)];
        const first = random.next(1, 500);
        let text = `${first}${unit}`;
        let total = BigInt(first);
        for (let t = random.next(1, 6); t > 0; t--) {
          const amount = random.next(0, 500);
          const subtract = random.next(2) === 0;
          text += (subtract ? ' - ' : ' + ') + amount;
          if (random.next(3) === 0) text += unit;
          total += BigInt(subtract ? -amount : amount);
        }
        const input = text;
        const result = CalcEngine.evaluate(input);
        expect(result.value, `#${n} '${input}' failed: ${result.error}`).not.toBeNull();
        assertSi(result.value!, total * nm, NmPerMetre, `#${n} '${input}'`);
        // What's written in is the whole story: the explicit text gives the same value without assuming anything.
        const strict = CalcEngine.evaluate(result.calculated, { assumeUnits: false });
        expect(strict.value !== null && strict.value.si.equals(result.value!.si), `#${n} '${result.calculated}'`).toBe(true);
      }
    },
    Timeout,
  );

  it(
    'plain numbers in a mixed sum are never guessed',
    () => {
      const random = new SeededRandom(20261009);
      for (let n = 0; n < Iterations; n++) {
        const a = WholeUnits[random.next(WholeUnits.length)];
        const b = WholeUnits[random.next(WholeUnits.length)];
        if (a[1] === b[1]) continue;
        let parts = [`${random.next(1, 99)}${a[0]}`, `${random.next(1, 99)}${b[0]}`, `${random.next(1, 99)}`];
        // OrderBy(_ => random.Next()): a shuffle by random keys.
        parts = parts
          .map((p) => [random.nextAny(), p] as const)
          .sort((x, y) => x[0] - y[0])
          .map((x) => x[1]);
        const input = parts.join(random.next(2) === 0 ? ' + ' : ' - ');
        const result = CalcEngine.evaluate(input);
        expect(result.value, `#${n} '${input}' guessed a unit`).toBeNull();
        expect(result.error).toBe('Missing unit');
        expect(result.assumed).toEqual([]);
      }
    },
    Timeout,
  );

  it(
    'highlighted minus signs are exactly the subtractions',
    () => {
      // The generator writes architectural 5'-6 1/2" literals as well as real subtractions, so this
      // checks that the colour shown for every hyphen agrees with how the engine calculated it.
      const random = new SeededRandom(5150);
      for (let n = 0; n < Iterations; n++) {
        const terms = random.next(1, 6);
        let text = '';
        let totalNm = 0n;
        let subtractions = 0;
        for (let t = 0; t < terms; t++) {
          const [termText, termNm] = randomLength(random, false);
          const subtract = t > 0 && random.next(2) === 0;
          if (t > 0) text += subtract ? ' - ' : ' + ';
          if (subtract) subtractions++;
          text += termText;
          totalNm += subtract ? -termNm : termNm;
        }
        const input = text;
        const minusSpans = CalcEngine.highlight(input).filter((s) => input[s.start] === '-').length;
        expect(minusSpans === subtractions, `#${n} '${input}': ${minusSpans} highlighted minus signs, ${subtractions} subtractions`).toBe(true);
        const result = CalcEngine.evaluate(input);
        expect(result.value, `#${n} '${input}' failed: ${result.error}`).not.toBeNull();
        assertSi(result.value!, totalNm, NmPerMetre, `#${n} '${input}'`);
      }
    },
    Timeout,
  );

  it(
    'random areas and volumes match the integer oracle',
    () => {
      const random = new SeededRandom(4242);
      for (let n = 0; n < Iterations; n++) {
        const [a, aNm] = randomLength(random, false);
        const [b, bNm] = randomLength(random, false);
        const area = CalcEngine.evaluate(`${a} x ${b}`);
        expect(area.value, `'${a} x ${b}' failed: ${area.error}`).not.toBeNull();
        expect(area.value!.power).toBe(2);
        assertSi(area.value!, aNm * bNm, NmPerMetre * NmPerMetre, `#${n} '${a} x ${b}'`);

        const [c, cNm] = randomLength(random, false);
        const volume = CalcEngine.evaluate(`${a} * ${b} * ${c}`);
        expect(volume.value, volume.error ?? undefined).not.toBeNull();
        expect(volume.value!.power).toBe(3);
        assertSi(volume.value!, aNm * bNm * cNm, NmPerMetre * NmPerMetre * NmPerMetre, `#${n} '${a} * ${b} * ${c}'`);
      }
    },
    Timeout,
  );

  it(
    'feet-inches formatting matches the integer oracle for every precision and mode',
    () => {
      const random = new SeededRandom(77);
      const denominators = [1, 2, 4, 8, 16, 32, 64];
      for (let n = 0; n < Iterations; n++) {
        // An exact value in 1/128ths of an inch, so 1/64" rounding has real work to do.
        const k128 = random.nextBig(-2_000_000n, 2_000_000n);
        const input = decimalText(k128, 128n) + '"';
        const evaluated = CalcEngine.evaluate(input);
        expect(evaluated.value, `#${n} '${input}' failed: ${evaluated.error}`).not.toBeNull();
        const value = evaluated.value!;
        for (const denominator of denominators)
          for (const mode of [RoundingMode.Nearest, RoundingMode.Up, RoundingMode.Down]) {
            const expected = oracleFeetInches(k128, 128n / BigInt(denominator), mode);
            const actual = Formatter.format(value, Formats.FeetInches, denominator, mode).text;
            expect(expected === actual, `#${n} ${input} at 1/${denominator} ${mode}: expected ${expected}, got ${actual}`).toBe(true);
          }
      }
    },
    Timeout,
  );

  it(
    'formatted results parse back to the same exact value',
    () => {
      const random = new SeededRandom(9001);
      for (let n = 0; n < Iterations; n++) {
        const k64 = random.nextBig(-1_000_000n, 1_000_000n);
        const value = Quantity.of(Rational.create(k64, 64n), Units.Inch);
        for (const format of [Formats.FeetInches, Formats.Inches]) {
          const text = Formatter.format(value, format, 64).text;
          const back = CalcEngine.evaluate(text);
          expect(back.value, `'${text}' did not parse: ${back.error}`).not.toBeNull();
          expect(value.si.equals(back.value!.si), `'${text}' parsed to ${back.value!.si}, expected ${value.si}`).toBe(true);
        }

        const um = random.nextBig(-50_000_000_000n, 50_000_000_000n);
        const metric = Quantity.of(Rational.create(um, 1_000_000n), Units.Meter);
        for (const [format, places] of [
          [Formats.Meters, 6],
          [Formats.Millimeters, 3],
          [Formats.Centimeters, 4],
        ] as const) {
          const text = Formatter.format(metric, format, places).text;
          const back = CalcEngine.evaluate(text);
          expect(back.value, `'${text}' did not parse: ${back.error}`).not.toBeNull();
          expect(metric.si.equals(back.value!.si), `'${text}' parsed to ${back.value!.si}, expected ${metric.si}`).toBe(true);
        }
      }
    },
    Timeout,
  );

  it(
    'rounding obeys its invariants',
    () => {
      const random = new SeededRandom(31337);
      const steps = [Rational.create(1n, 64n), Rational.create(1n, 16n), Rational.create(1n, 4n), R(1), Rational.parse('0.001'), Rational.parse('0.05'), R(12)];
      const two = R(2);
      for (let n = 0; n < Iterations; n++) {
        const x = Rational.create(random.nextBig(-10_000_000_000n, 10_000_000_000n), random.nextBig(1n, 1_000_000n));
        for (const step of steps) {
          const down = x.roundToMultiple(step, RoundingMode.Down);
          const up = x.roundToMultiple(step, RoundingMode.Up);
          const nearest = x.roundToMultiple(step, RoundingMode.Nearest);
          expect(down.le(x) && x.le(up), `${x} step ${step}: ${down} ≤ x ≤ ${up}`).toBe(true);
          const spread = up.sub(down);
          expect(spread.equals(Rational.Zero) || spread.equals(step), `${x} step ${step}: up − down = ${spread}`).toBe(true);
          expect(nearest.sub(x).abs().mul(two).le(step), `${x} step ${step}: nearest ${nearest} too far`).toBe(true);
          expect(nearest.equals(down) || nearest.equals(up)).toBe(true);
          for (const r of [down, up, nearest]) expect(r.div(step).isInteger, `${r} is not a multiple of ${step}`).toBe(true);

          // A value already on the increment never moves, in any mode.
          const onGrid = Rational.of(random.nextBig(-1_000_000n, 1_000_000n)).mul(step);
          for (const mode of [RoundingMode.Nearest, RoundingMode.Up, RoundingMode.Down])
            expect(onGrid.roundToMultiple(step, mode).equals(onGrid), `${onGrid} moved under ${mode} rounding to ${step}`).toBe(true);
        }
      }
    },
    Timeout,
  );
});
