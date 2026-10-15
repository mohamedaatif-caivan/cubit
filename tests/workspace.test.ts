import { describe, expect, it } from 'vitest';
import { AppState, SavedValue, TapeEntry } from '../src/core/appState';
import { CalcEngine } from '../src/core/calcEngine';
import { CopyPresets, CopyRounding, DefaultCopyPreset } from '../src/core/copyPreset';
import type { DisplayFormat } from '../src/core/formats';
import { Formats } from '../src/core/formats';
import { Formatter } from '../src/core/formatter';
import { HyphenAfterFeet } from '../src/core/parser';
import { Quantity, quantity } from '../src/core/quantity';
import { R, Rational } from '../src/core/rational';
import { allPassed, runSelfCheck } from '../src/core/selfCheck';
import { StateFormatError, StateStore } from '../src/core/stateStore';
import { Units as U } from '../src/core/units';

/**
 * Port of WorkspaceTests.cs. The web app persists with StateStore.toJson/fromJson (localStorage), so
 * "save then load" is a JSON round trip; the desktop's file-system behaviour (atomic temp-file write,
 * .bak backup, moving an unreadable file aside) has no web equivalent and isn't ported.
 */
const roundTrip = (state: AppState): { state: AppState; warning: string | null; json: string } => {
  const json = StateStore.toJson(state);
  return { ...StateStore.fromJson(json), json };
};

const tapeEntry = (input: string, value: Quantity, note: string | null = null, formatId: string | null = null): TapeEntry => ({
  id: crypto.randomUUID(),
  input,
  value,
  at: new Date().toISOString(),
  note,
  hyphen: HyphenAfterFeet.FeetAndInches,
  formatId,
});

const saved = (name: string, value: Quantity, source: string, formatId: string | null = null): SavedValue => ({ name, value, source, formatId });

describe('workspace state', () => {
  it('state round-trips exactly', () => {
    const state = new AppState();
    const third = quantity(Rational.create(1n, 3n), 1); // not representable as a float
    state.save(saved('Wall', third, '1m / 3', 'm'));
    state.addToTape(tapeEntry('1m / 3', third, 'note', 'mm'));
    state.settings.answerFollowsInput = false;
    state.settings.assumeUnits = false;
    state.memory = quantity(Rational.sqrt(R(2)).value, 0, false);
    state.settings.setPrimary(Formats.Millimeters);
    state.settings.copyPreset = CopyPresets.make('ft-in', CopyRounding.Up, 8);

    const { state: loaded, warning, json } = roundTrip(state);

    expect(warning).toBeNull();
    expect(loaded.savedValues).toHaveLength(1);
    expect(loaded.savedValues[0].value).toEqual(third);
    expect(loaded.tape).toHaveLength(1);
    expect(loaded.tape[0].value).toEqual(third);
    expect(loaded.memory).toEqual(state.memory);
    expect(loaded.settings.primaryFor(1)).toBe(Formats.Millimeters);
    expect(loaded.settings.copyPreset).toEqual(state.settings.copyPreset);
    expect(loaded.savedValues[0].formatId).toBe('m');
    expect(loaded.tape[0].formatId).toBe('mm');
    expect(loaded.settings.answerFollowsInput).toBe(false);
    expect(loaded.settings.assumeUnits).toBe(false);
    expect(json).not.toContain('0.333'); // stored as an exact fraction
    expect(json).toContain('"1/3"'); // ... written as "n/d" text, never a JSON float
  });

  it('hidden units persist and never hide the primary format', () => {
    const state = new AppState();
    state.settings.setVisible(Formats.Yards, false);
    state.settings.setVisible(Formats.FeetInches, false); // the primary for lengths
    const settings = roundTrip(state).state.settings;

    const visible = settings.visibleFormats(1);
    expect(visible).not.toContain(Formats.Yards);
    expect(visible).toContain(Formats.FeetInches);
    expect(visible).toHaveLength(Formats.forPower(1).length - 1);

    settings.setVisible(Formats.Yards, true);
    expect(settings.visibleFormats(1)).toContain(Formats.Yards);
  });

  it('unreadable state is rejected, not half-loaded', () => {
    // Desktop: the file is moved aside as state.unreadable-*.json and Cubit starts fresh. Web: fromJson
    // reports StateFormatError so the caller can keep the raw text and start from a new AppState.
    expect(() => StateStore.fromJson('{ this is not json')).toThrow(StateFormatError);
    expect(() => StateStore.fromJson('[1, 2, 3]')).toThrow(StateFormatError);
    expect(new AppState().tape).toHaveLength(0);
  });

  it('missing (empty) data gives defaults', () => {
    const { state, warning } = StateStore.fromJson('{}');
    expect(warning).toBeNull();
    expect(state.settings.primaryFor(1)).toBe(Formats.FeetInches);
    expect(new AppState().settings.primaryFor(1)).toBe(Formats.FeetInches);
  });

  it('unreadable items are left out with a warning, the rest still loads (web tolerant loading)', () => {
    const state = new AppState();
    state.addToTape(tapeEntry(`2'`, Quantity.of(R(2), U.Foot)));
    state.addToTape(tapeEntry(`3'`, Quantity.of(R(3), U.Foot)));
    state.save(saved('wall', Quantity.of(R(4), U.Meter), '4m', 'm'));
    const raw = JSON.parse(StateStore.toJson(state));
    raw.tape[0].value.si = '0.333333'; // decimal text is exact too, so this one is fine
    raw.tape[1].value.si = 'not a number';
    raw.savedValues.push({ name: 'broken', value: { si: 1.5, power: 1 } }); // a JSON float is never accepted
    raw.memory = { si: '1/0', power: 1 };
    const { state: loaded, warning } = StateStore.fromJson(JSON.stringify(raw));
    expect(loaded.tape.map((e) => e.input)).toEqual([`2'`]);
    expect(loaded.tape[0].value.si).toEqual(Rational.parse('0.333333'));
    expect(loaded.savedValues.map((v) => v.name)).toEqual(['wall']);
    expect(loaded.memory).toBeNull();
    expect(warning).toBe("3 saved items couldn't be read and were left out.");
  });

  it('data from a newer version loads with a warning', () => {
    const raw = JSON.parse(StateStore.toJson(new AppState()));
    raw.schema = AppState.CurrentSchema + 1;
    expect(StateStore.fromJson(JSON.stringify(raw)).warning).toBe('Your settings were saved by a newer version of Cubit. Some options may be reset.');
  });

  it.each<[string, boolean]>([
    ['wall', true],
    ['Wall_2', true],
    ['2wall', false],
    ['my wall', false],
    ['ans', false],
    ['PI', false],
    ['', false],
  ])('saved value name %j is valid: %s', (name, valid) => {
    expect(AppState.validateName(name) === null).toBe(valid);
  });

  it('saved values are case-insensitive and usable in expressions', () => {
    const state = new AppState();
    state.save(saved('TFW', Quantity.of(R(100), U.Meter), '100m'));
    state.save(saved('tfw', Quantity.of(R(101), U.Meter), '101m'));
    expect(state.savedValues).toHaveLength(1);

    const result = CalcEngine.evaluate('@Tfw + 1m', { savedValues: state.savedLookup });
    expect(result.value!.si).toEqual(Rational.create(102n, 1n));
  });

  it('tape is capped', () => {
    const state = new AppState();
    for (let n = 0; n < AppState.MaxTapeEntries + 25; n++) state.addToTape(tapeEntry(String(n), Quantity.number(R(n))));
    expect(state.tape).toHaveLength(AppState.MaxTapeEntries);
    expect(state.tape[0].input).toBe('25');
  });

  it('tape limit also applies when loading', () => {
    const state = new AppState();
    for (let n = 0; n < AppState.MaxTapeEntries; n++) state.addToTape(tapeEntry(String(n), Quantity.number(R(n))));
    const raw = JSON.parse(StateStore.toJson(state));
    raw.tape.unshift(...raw.tape.slice(0, 25)); // a file edited by hand, over the limit
    const loaded = StateStore.fromJson(JSON.stringify(raw)).state;
    expect(loaded.tape).toHaveLength(AppState.MaxTapeEntries);
    expect(loaded.tape[0].input).toBe('0');
  });

  it('answer and memory are available to expressions', () => {
    const context = { answer: Quantity.of(R(10), U.Foot), memory: Quantity.of(R(6), U.Inch) };
    const result = CalcEngine.evaluate('ans + mem', context);
    expect(Formatter.format(result.value!, Formats.FeetInches, 16).text).toBe(`10'-6"`);
  });

  it('shipped self-check passes', () => {
    const report = runSelfCheck();
    expect(allPassed(report), report.failures.join('\n')).toBe(true);
    expect(report.total).toBeGreaterThan(90);
  });

  it('copy preset formats without touching the value', () => {
    const value = CalcEngine.evaluate(`1'6 5/16"`).value!;
    const preset = CopyPresets.make('ft-in', CopyRounding.Up, 4);
    expect(CopyPresets.format(preset, value, Formats.FeetInches, () => 16)).toBe(`1'-6 1/2"`);
    expect(CopyPresets.format(DefaultCopyPreset, value, Formats.FeetInches, () => 16)).toBe(`1'-6 5/16"`);
    // A length preset applied to an area falls back to the area's own format.
    const area = CalcEngine.evaluate(`12' x 14'`).value!;
    expect(CopyPresets.format(preset, area, Formats.SquareFeet, (f: DisplayFormat) => f.defaultPrecision)).toBe('168.00');
  });

  it('decimal copies are plain numbers unless the unit is asked for', () => {
    const value = CalcEngine.evaluate(`5'6"`).value!;
    const dp = (f: DisplayFormat): number => f.defaultPrecision;
    expect(CopyPresets.format(CopyPresets.make('mm', CopyRounding.AsShown, 1), value, Formats.FeetInches, dp)).toBe('1676.4');
    expect(CopyPresets.format(CopyPresets.make('mm', CopyRounding.AsShown, 1, true), value, Formats.FeetInches, dp)).toBe('1676.4 mm');
    expect(CopyPresets.format(DefaultCopyPreset, value, Formats.FeetInches, () => 16)).toBe(`5'-6"`); // marks are part of ft-in
    expect(CopyPresets.format(CopyPresets.make('in-frac', CopyRounding.AsShown, 16), value, Formats.FeetInches, () => 16)).toBe('66"');
    expect(Formatter.format(value, Formats.Millimeters, 1, undefined, true).text).toBe('1,676.4 mm'); // display keeps the unit
  });
});
