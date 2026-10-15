import { describe, expect, it } from 'vitest';
import { AppState } from '../src/core/appState';
import { CopyPresets, CopyRounding } from '../src/core/copyPreset';
import { Formats } from '../src/core/formats';
import { CalculatorSession, NoHints } from '../src/core/session';

/** Port of SessionTests.cs: the calculator screen's behaviour, tested without any UI. */
const newSession = (): CalculatorSession => new CalculatorSession(new AppState());

function withTape(...inputs: string[]): CalculatorSession {
  const session = newSession();
  for (const input of inputs) {
    session.setInput(input);
    expect(session.commit(), `commit '${input}'`).not.toBeNull();
  }
  return session;
}

/** The wider space (U+2002 EN SPACE) the big display puts before fractions. */
const EnSpace = ' ';

describe('calculator session', () => {
  it('live result follows the input', () => {
    const s = newSession();
    s.setInput(`5'6 1/2" + 1'`);
    expect(s.canCopy).toBe(true);
    expect(s.display!.text).toBe(`6'-6 1/2"`);
    expect(s.display!.screenText).toBe(`6'-6${EnSpace}1/2"`); // wider space on screen only
    expect(s.display!.caption).toBe('Feet-inches · exact');
  });

  it('an error keeps the previous value but marks it stale', () => {
    const s = newSession();
    s.setInput(`5'`);
    s.setInput(`1 + 5'`);
    expect(s.isStale).toBe(true);
    expect(s.error).toBe('Missing unit');
    expect(s.display!.text).toBe(`5'-0"`);
    expect(s.errorRange).toEqual({ start: 0, end: 1 });
    expect(s.canCopy).toBe(false);
    expect(s.copyText()).toBeNull();
    expect(s.tileCopyText(Formats.Millimeters, false)).toBeNull();
    expect(s.save('wall')).toBe('Missing unit');
    expect(s.memoryAdd(1)).toBe('Missing unit');
  });

  it('unfinished input underlines the last character', () => {
    const s = newSession();
    s.setInput(`5' + `);
    expect(s.error).toBe('Unfinished');
    expect(s.errorRange).toEqual({ start: 3, end: 4 });
  });

  it('commit adds to the tape and echoes the calculation', () => {
    const s = withTape(`2' + 3'`);
    expect(s.state.tape).toHaveLength(1);
    expect(s.input).toBe('');
    expect(s.echo).toBe(`2' + 3' =`);
    expect(s.display!.text).toBe(`5'-0"`);
    expect(s.canCopy).toBe(true);
  });

  it('commit refuses invalid input', () => {
    const s = newSession();
    s.setInput(`3 + 12'`);
    expect(s.commit()).toBeNull();
    expect(s.state.tape).toHaveLength(0);
    expect(s.error).toBe('Missing unit');
  });

  it.each<[string, string | null]>([
    ['+', 'ans + '],
    ['-', 'ans - '],
    [' x ', 'ans x '],
    ['²', 'ans²'],
    ['5', null],
    ['(', null],
  ])('operator %j on an empty line continues from the answer as %j', (typed, expected) => {
    const s = withTape(`10'`);
    expect(s.continueFromAnswer('', typed)).toBe(expected);
    expect(s.continueFromAnswer('2', '2+')).toBeNull(); // only from an empty line
  });

  it('nothing continues before the first answer', () => {
    expect(newSession().continueFromAnswer('', '-')).toBeNull();
  });

  it('copy rules match the target apps', () => {
    const s = newSession();
    s.setInput(`5'6"`);
    expect(s.copyText()).toBe(`5'-6"`);
    expect(s.tileCopyText(Formats.Millimeters, false)).toBe('1676.4');
    expect(s.tileCopyText(Formats.Millimeters, true)).toBe('1676.4 mm');
    expect(s.copyText(CopyPresets.make('mm', CopyRounding.AsShown, 1))).toBe('1676.4');
    expect(s.copyLabel).toBe('Copy');
    s.settings.copyPreset = CopyPresets.make('mm', CopyRounding.AsShown, 1);
    expect(s.copyLabel).toBe('Copy · mm');
  });

  it('deleting a tape entry can be undone in place', () => {
    const s = withTape(`1'`, `2'`, `3'`);
    const middle = s.state.tape[1];
    expect(s.deleteTape(middle.id)).toBe(true);
    expect(s.state.tape).toHaveLength(2);
    expect(s.lastUndo!.description).toBe(`Deleted 2'-0"`);
    expect(s.undo()).toBe(true);
    expect(s.state.tape.map((e) => e.input)).toEqual([`1'`, `2'`, `3'`]);
    expect(s.undo()).toBe(false); // only once
  });

  it('clearing the tape can be undone', () => {
    const s = withTape(`1'`, `2'`);
    s.clearTape();
    expect(s.state.tape).toHaveLength(0);
    expect(s.undo()).toBe(true);
    expect(s.state.tape).toHaveLength(2);
  });

  it('deleting a saved value can be undone', () => {
    const s = newSession();
    s.setInput(`9'-1 1/8"`);
    expect(s.save('wall')).toBeNull();
    expect(s.deleteSaved('WALL')).toBe(true);
    expect(s.state.savedValues).toHaveLength(0);
    s.setInput('@wall');
    expect(s.error).toBe('No saved value @wall');
    expect(s.undo()).toBe(true);
    expect(s.error).toBeNull(); // the restored value works again straight away
    expect(s.display!.text).toBe(`9'-1 1/8"`);
  });

  it('notes appear in text and csv exports', () => {
    const s = withTape(`12' x 14'`);
    const id = s.state.tape[0].id;
    expect(s.setNote(id, '  kitchen floor ')).toBe(true);
    expect(s.state.tape[0].note).toBe('kitchen floor');
    expect(s.tapeAsText().endsWith('168.00 ft²  // kitchen floor')).toBe(true);
    expect(s.tapeAsCsv()).toContain(',kitchen floor,');
    expect(s.setNote(id, '')).toBe(true);
    expect(s.state.tape[0].note).toBeNull();
  });

  it('csv has a numeric value column', () => {
    const s = withTape(`5'6"`);
    const row = s.tapeAsCsv().split('\r\n')[1].split(',');
    expect(row[3]).toBe('66.0000');
    expect(row[4]).toBe('in');
  });

  it.each([
    [`5'6" + 2'`, `(5'6" + 2')`],
    [`5'6" to mm`, `(5'6")`],
  ])('tape value %s inserts exactly as %s', (input, expected) => {
    const s = withTape(input);
    expect(CalculatorSession.tapeInsertText(s.state.tape[0])).toBe(expected);
  });

  it('tape values that used names insert as numbers', () => {
    const s = withTape(`10'`, 'ans + 1m');
    const text = CalculatorSession.tapeInsertText(s.state.tape[1]);
    expect(text).toBe('(4048.000000000000mm)');
    s.setInput(text);
    expect(s.display!.value).toEqual(s.state.tape[1].value);
  });

  it('memory keeps one dimension', () => {
    const s = newSession();
    s.setInput(`5'`);
    expect(s.memoryAdd(1)).toBeNull();
    s.setInput(`12' x 14'`);
    expect(s.memoryAdd(1)).toBe('Memory holds length');
    s.setInput(`mem + 1'`);
    expect(s.display!.text).toBe(`6'-0"`);
  });

  it('hidden units leave the tiles but the primary stays', () => {
    const s = newSession();
    s.settings.answerFollowsInput = false;
    s.settings.setVisible(Formats.Yards, false);
    s.settings.setVisible(Formats.FeetInches, false);
    s.setInput('1m');
    const tiles = s.display!.tiles.map((t) => t.format);
    expect(tiles).not.toContain(Formats.Yards);
    expect(tiles).toContain(Formats.FeetInches);
    const feetInches = s.display!.tiles.filter((t) => t.format === Formats.FeetInches);
    expect(feetInches).toHaveLength(1);
    expect(feetInches[0].isPrimary).toBe(true);
  });

  it('history is newest first', () => {
    expect(withTape(`1'`, `2'`, `3'`).history).toEqual([`3'`, `2'`, `1'`]);
  });

  it('answer survives a restart', () => {
    const state = withTape(`7'`).state;
    const reopened = new CalculatorSession(state);
    expect(reopened.echo).toBe(`7' =`);
    expect(reopened.display!.text).toBe(`7'-0"`);
  });

  // ---------------- Answer unit ----------------

  it.each([
    ['1m + 1', 'm', '2.0000 m'],
    ['1" + 1 + 2', 'in-frac', '4"'],
    [`5'6" + 2'`, 'ft-in', `7'-6"`],
    [`48" + 1'`, 'in-frac', '60"'],
    ['300mm + 1m', 'mm', '1,300.0 mm'],
    ['3m x 4m', 'm2', '12.000 m²'],
    [`20' x 30' x 4"`, 'yd3', '7.41 yd³'],
    ['10 sq ft + 5', 'ft2', '15.00 ft²'],
    ['1m + 1 to mm', 'mm', '2,000.0 mm'],
    ['2 x 3', 'num', '6'],
  ])('the answer follows the first unit typed: %s shows as %s (%s)', (input, formatId, expected) => {
    const s = newSession();
    s.setInput(input);
    expect(s.display!.format.id).toBe(formatId);
    expect(s.display!.text).toBe(expected);
    const tiles = s.display!.tiles;
    if (tiles.length > 0) {
      const primary = tiles.filter((t) => t.isPrimary);
      expect(primary).toHaveLength(1);
      expect(primary[0].format.id).toBe(formatId);
    }
  });

  it('areas and volumes from lengths use your unit for that system', () => {
    const s = newSession();
    s.settings.setPrimary(Formats.CubicFeet);
    s.setInput(`10' x 10' x 1'`);
    expect(s.display!.format).toBe(Formats.CubicFeet); // your imperial volume unit
    s.setInput('1m x 1m x 1m');
    expect(s.display!.format).toBe(Formats.CubicMeters); // ft³ isn't metric: the usual metric one
  });

  it('picking a unit fixes the answer and links areas and volumes', () => {
    const s = newSession();
    s.setInput(`5'`);
    s.pickUnit(Formats.Meters);
    expect(s.settings.answerFollowsInput).toBe(false);
    expect(s.display!.text).toBe('1.5240 m');
    expect(s.settings.primaryFor(2)).toBe(Formats.SquareMeters);
    expect(s.settings.primaryFor(3)).toBe(Formats.CubicMeters);
    s.setInput(`10' x 10'`);
    expect(s.display!.format).toBe(Formats.SquareMeters);

    s.pickUnit(Formats.FeetInches);
    expect(s.settings.primaryFor(2)).toBe(Formats.SquareFeet);
    expect(s.settings.primaryFor(3)).toBe(Formats.CubicYards);

    s.pickUnit(Formats.Acres); // an area pick doesn't touch lengths
    expect(s.settings.primaryFor(1)).toBe(Formats.FeetInches);

    s.setAnswerFollowsInput(true);
    s.setInput('1m + 1');
    expect(s.display!.format).toBe(Formats.Meters);
  });

  it('picking a length keeps an area unit already in that system', () => {
    const s = newSession();
    s.settings.setPrimary(Formats.SquareYards);
    s.pickUnit(Formats.DecimalFeet);
    expect(s.settings.primaryFor(2)).toBe(Formats.SquareYards);
  });

  it('the tape keeps each result in the unit it was shown in', () => {
    const s = withTape('1m + 1', `5'`);
    expect(s.state.tape[0].input).toBe('1m + 1m'); // the assumed unit is written in
    expect(s.state.tape[0].formatId).toBe('m');
    s.pickUnit(Formats.Millimeters);
    expect(s.tapeAsText().startsWith('1m + 1m = 2.0000 m')).toBe(true);
    expect(s.formatPrimary(s.state.tape[0].value, s.state.tape[0].formatId)).toBe('2.0000 m');
    expect(s.copyFormat(s.state.tape[0].value, s.state.tape[0].formatId).slice(0, 1)).toBe('2');
  });

  it('the answer shows as calculated until a unit is picked', () => {
    const s = withTape('1m + 1');
    expect(s.display!.text).toBe('2.0000 m');
    s.pickUnit(Formats.Millimeters);
    expect(s.display!.text).toBe('2,000.0 mm');
  });

  it('ans continues in the unit the answer is shown in', () => {
    const s = withTape('1m + 1');
    s.setInput(s.continueFromAnswer('', '+') + '1');
    expect(s.input).toBe('ans + 1');
    expect(s.display!.text).toBe('3.0000 m');
    expect(s.result.calculated).toBe('ans + 1m');

    const feet = withTape(`7'6"`); // feet-inches is two units: no guess
    feet.setInput('ans + 1');
    expect(feet.error).toBe('Missing unit');
  });

  it('plain numbers stay plain when assuming is off', () => {
    const s = newSession();
    s.settings.assumeUnits = false;
    s.setInput('1m + 1');
    expect(s.error).toBe('Missing unit');
    expect(s.hintsAt(6)).toEqual(NoHints);
  });

  it('hidden formats still show when they are the answer', () => {
    const s = newSession();
    s.settings.setVisible(Formats.Centimeters, false);
    s.setInput('10cm + 5');
    const cm = s.display!.tiles.filter((t) => t.format === Formats.Centimeters);
    expect(cm).toHaveLength(1);
    expect(cm[0].isPrimary).toBe(true);
  });

  // ---------------- Ghost and written-in units ----------------

  it('the number being typed gets a ghost unit at the end', () => {
    const s = newSession();
    s.setInput('1m + 1');
    const hints = s.hintsAt(6);
    expect(hints.write).toEqual([]);
    expect(hints.ghost).toEqual({ position: 6, text: 'm' });
  });

  it('a trailing space keeps the ghost and drops its leading space', () => {
    const s = newSession();
    s.setInput('5 ft + 3 ');
    expect(s.hintsAt(9).ghost).toEqual({ position: 9, text: 'ft' });
    s.setInput('5 ft + 3');
    expect(s.hintsAt(8).ghost).toEqual({ position: 8, text: ' ft' });
  });

  it('units are written in once the caret moves past the number', () => {
    const s = newSession();
    s.setInput('1m + 1 + 2');
    const hints = s.hintsAt(10);
    expect(hints.write).toEqual([{ numberStart: 5, position: 6, text: 'm' }]);
    expect(hints.ghost).toEqual({ position: 10, text: 'm' });

    s.setInput('1m + 1 +'); // typed the operator
    expect(s.hintsAt(8).write).toEqual([{ numberStart: 5, position: 6, text: 'm' }]);
    expect(s.hintsAt(8).ghost).toBeNull();
  });

  it('a number edited in the middle waits without a ghost', () => {
    const s = newSession();
    s.setInput('1m + 5 + 2m');
    const hints = s.hintsAt(6); // caret right after the 5
    expect(hints.write).toEqual([]);
    expect(hints.ghost).toBeNull(); // a ghost would cover the text after it
    expect(s.hintsAt(0).write).toEqual([{ numberStart: 5, position: 6, text: 'm' }]);
  });

  it('feet and inch marks are written as marks', () => {
    const s = newSession();
    s.setInput(`5' + 3 + 1`);
    expect(s.result.calculated).toBe(`5' + 3' + 1'`);
    expect(s.hintsAt(10).ghost).toEqual({ position: 10, text: "'" });
  });

  it('saving keeps the display format', () => {
    const s = newSession();
    s.setInput('2m + 1');
    expect(s.save('slab')).toBeNull();
    expect(s.state.savedValues[0].formatId).toBe('m');
    expect(s.state.savedValues[0].source).toBe('2m + 1m');
  });
});
