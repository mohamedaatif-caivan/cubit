import { describe, expect, it } from 'vitest';
import { AppState } from '../src/core/appState';
import { CalcEngine } from '../src/core/calcEngine';
import { CopyPresets, CopyRounding } from '../src/core/copyPreset';
import { DisplayFormat, Formats } from '../src/core/formats';
import { Formatter } from '../src/core/formatter';
import type { Quantity } from '../src/core/quantity';
import { StateStore } from '../src/core/stateStore';

/** Port of CustomRoundingTests.cs: "Round to [step] [unit]": any step, not just powers of ten or binary fractions. */
const Q = (input: string): Quantity => CalcEngine.evaluate(input).value!;
const defaultPrecision = (f: DisplayFormat): number => f.defaultPrecision;

describe('custom rounding steps', () => {
  it.each([
    // Concrete is ordered in quarter or half yards.
    ['16.4 yd3', 'yd3', '0.25', CopyRounding.Up, '16.50'],
    ['16.4 yd3', 'yd3', '0.25', CopyRounding.Down, '16.25'],
    ['16.4 yd3', 'yd3', '1/2', CopyRounding.Nearest, '16.5'],
    ['16.4 yd3', 'yd3', '1', CopyRounding.Up, '17'],
    // Metric to the nearest 5 or 10 mm.
    ['1676.4mm', 'mm', '5', CopyRounding.Nearest, '1675'],
    ['1676.4mm', 'mm', '10', CopyRounding.Up, '1680'],
    ['1676.4mm', 'mm', '0.5', CopyRounding.Nearest, '1676.5'],
    // Feet-inches steps are in inches.
    [`5'6 1/2"`, 'ft-in', '2', CopyRounding.Nearest, `5'-6"`],
    [`5'6 1/2"`, 'ft-in', '1 1/2', CopyRounding.Up, `5'-7 1/2"`],
    [`5'6 1/2"`, 'ft-in', '1/8', CopyRounding.Down, `5'-6 1/2"`],
  ])('%s as %s to step %s (%s) is %s', (input, formatId, step, rounding, expected) => {
    const preset = CopyPresets.make(formatId, rounding, 0, false, step);
    expect(CopyPresets.format(preset, Q(input), Formats.FeetInches, defaultPrecision)).toBe(expected);
  });

  it.each(['', 'abc', '0', '-5', '1/0', '1 2 3'])('invalid step %j is ignored', (step) => {
    expect(CopyPresets.tryParseIncrement(step)).toBeNull();
    const preset = CopyPresets.make('mm', CopyRounding.Nearest, 1, false, step);
    expect(CopyPresets.format(preset, Q('1676.4mm'), Formats.FeetInches, defaultPrecision)).toBe('1676.4');
  });

  it.each([
    ['0.25', 2],
    ['5', 0],
    ['0.125', 3],
    ['1/3', 6],
  ])('decimal places follow the step %s -> %i', (step, places) => {
    const increment = CopyPresets.tryParseIncrement(step);
    expect(increment).not.toBeNull();
    expect(Formatter.placesFor(increment!)).toBe(places);
  });

  it('custom steps survive save and load', () => {
    const state = new AppState();
    state.settings.copyPreset = CopyPresets.make('yd3', CopyRounding.Up, 2, false, '0.25');
    const loaded = StateStore.fromJson(StateStore.toJson(state)).state;
    expect(loaded.settings.copyPreset.increment).toBe('0.25');
  });
});
