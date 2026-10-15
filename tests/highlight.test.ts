import { describe, expect, it } from 'vitest';
import { CalcEngine } from '../src/core/calcEngine';
import { Formats } from '../src/core/formats';
import { Formatter } from '../src/core/formatter';
import { HyphenAfterFeet } from '../src/core/parser';

/** Port of HighlightTests.cs: the input colouring must always describe what the engine actually calculated. */
const operators = (input: string, hyphen: HyphenAfterFeet = HyphenAfterFeet.FeetAndInches): string =>
  CalcEngine.highlight(input, hyphen)
    .map((s) => input.slice(s.start, s.end))
    .join(' ');

function result(input: string, hyphen: HyphenAfterFeet = HyphenAfterFeet.FeetAndInches): string {
  const r = CalcEngine.evaluate(input, { hyphenAfterFeet: hyphen });
  expect(r.value, r.error ?? undefined).not.toBeNull();
  return Formatter.format(r.value!, Formats.FeetInches, 16).text;
}

describe('highlighting', () => {
  it.each<[string, string, string | null]>([
    [`4'-2"`, '', `4'-2"`],
    [`4' - 2"`, '-', `3'-10"`],
    [`4'-2" + 1'`, '+', `5'-2"`],
    [`9'-1 1/8" - 3 5/8"`, '-', `8'-9 1/2"`],
    [`6-1/2"`, '', `6 1/2"`],
    [`5'6-1/2"`, '', `5'-6 1/2"`],
    [`10'6"-3"`, '-', `10'-3"`],
    [`5'-2'`, '-', `3'-0"`],
    [`-5'6"`, '-', `-5'-6"`],
    [`12'x14' to ft2`, 'x to', null],
    [`(2' + 6") * 2`, '+ *', `5'-0"`],
  ])('default setting colours only real operators: %s', (input, ops, expected) => {
    expect(operators(input)).toBe(ops);
    if (expected !== null) expect(result(input)).toBe(expected);
  });

  it.each([
    [`4'-2"`, '-', `3'-10"`],
    [`9'-1 1/8" - 3 5/8"`, '- -', `8'-7 1/4"`],
    [`5'-6 1/2"`, '-', `4'-5 1/2"`],
    [`6-1/2"`, '', `6 1/2"`],
    [`5'6"`, '', `5'-6"`],
  ])('minus setting reads the hyphen as subtraction: %s', (input, ops, expected) => {
    expect(operators(input, HyphenAfterFeet.Minus)).toBe(ops);
    expect(result(input, HyphenAfterFeet.Minus)).toBe(expected);
  });

  it.each([
    [`4'-`, '-'],
    [`4'-2`, '-'],
    [`5' + ab`, '+'],
    ['', ''],
  ])('unfinished input is still highlighted: %j', (input, ops) => {
    expect(operators(input)).toBe(ops);
  });

  it('error span points at the problem', () => {
    const input = `1 + 5'`;
    const r = CalcEngine.evaluate(input);
    expect(input.slice(r.errorStart, r.errorEnd)).toBe('1');
  });
});
