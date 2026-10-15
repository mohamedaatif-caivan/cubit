import { RoundingMode } from './rational';
import { CalcEngine } from './calcEngine';
import { Formats } from './formats';
import { Formatter } from './formatter';
import calculationsTsv from './verification/calculations.tsv?raw';
import errorsTsv from './verification/errors.tsv?raw';

export interface SelfCheckReport {
  readonly passed: number;
  readonly total: number;
  readonly failures: readonly string[];
}

export const allPassed = (r: SelfCheckReport): boolean => r.failures.length === 0 && r.total > 0;

/** Rows of a verification table, skipping blank lines and # comments. */
export function rows(tsv: string, columns: number): string[][] {
  return tsv
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length === columns);
}

export const Tables = { calculations: calculationsTsv, errors: errorsTsv };

export const parseRounding = (text: string): RoundingMode =>
  text === 'up' ? RoundingMode.Up : text === 'down' ? RoundingMode.Down : RoundingMode.Nearest;

/**
 * Re-runs the hand-checked answer tables that ship inside Cubit (the same files as the desktop app), so
 * anyone can confirm on their own device that the copy they're using gets them right.
 */
export function runSelfCheck(): SelfCheckReport {
  const failures: string[] = [];
  let total = 0;
  for (const [input, formatId, precisionText, rounding, expected] of rows(calculationsTsv, 5)) {
    total++;
    const result = CalcEngine.evaluate(input);
    const format = Formats.byId(formatId);
    if (result.value === null || !format) {
      failures.push(`${input} → error: ${result.error ?? 'unknown format ' + formatId}`);
      continue;
    }
    const actual = Formatter.format(result.value, format, Number.parseInt(precisionText, 10), parseRounding(rounding)).text;
    if (actual !== expected) failures.push(`${input} → ${actual}, expected ${expected}`);
  }
  for (const [input, fragment] of rows(errorsTsv, 2)) {
    total++;
    const result = CalcEngine.evaluate(input);
    if (result.value !== null || !result.error?.toLowerCase().includes(fragment.toLowerCase()))
      failures.push(`${input} should be rejected ("${fragment}")`);
  }
  return { passed: total - failures.length, total, failures };
}
