import { describe, expect, it } from 'vitest';
import { CalcEngine } from '../src/core/calcEngine';
import { Formats } from '../src/core/formats';
import { Formatter } from '../src/core/formatter';
import { allPassed, parseRounding, rows, runSelfCheck, Tables } from '../src/core/selfCheck';

/** Runs every row of src/core/verification/*.tsv (the desktop app's hand-checked tables). */
describe('golden calculations', () => {
  it.each(rows(Tables.calculations, 5))('%s as %s to %s (%s) is %s', (input, formatId, precision, rounding, expected) => {
    const result = CalcEngine.evaluate(input);
    expect(result.error, `'${input}' failed`).toBeNull();
    const format = Formats.byId(formatId);
    expect(format, `unknown format ${formatId}`).toBeDefined();
    expect(Formatter.format(result.value!, format!, Number.parseInt(precision, 10), parseRounding(rounding)).text).toBe(expected);
  });
});

describe('golden errors', () => {
  it.each(rows(Tables.errors, 2))('%s is rejected with "%s"', (input, fragment) => {
    const result = CalcEngine.evaluate(input);
    expect(result.value, `'${input}' should fail`).toBeNull();
    expect(result.error!.toLowerCase()).toContain(fragment.toLowerCase());
    expect(result.errorStart).toBeGreaterThanOrEqual(0);
    expect(result.errorStart).toBeLessThanOrEqual(input.length);
    expect(result.errorEnd).toBeGreaterThanOrEqual(result.errorStart);
    expect(result.errorEnd).toBeLessThanOrEqual(input.length);
  });
});

describe('in-app self-check', () => {
  it('passes every row', () => {
    const report = runSelfCheck();
    expect(report.failures).toEqual([]);
    expect(allPassed(report)).toBe(true);
    expect(report.total).toBeGreaterThan(100);
  });
});
