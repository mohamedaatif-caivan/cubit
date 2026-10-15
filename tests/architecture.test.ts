import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

/**
 * Port of ArchitectureTests.cs: guards that keep the engine trustworthy as it grows.
 * Reads src/core through Vite's import.meta.glob (no Node file APIs needed).
 */
const sources: Record<string, string> = import.meta.glob(['../src/core/**/*.ts'], { query: '?raw', import: 'default', eager: true });
const files = Object.entries(sources).map(([path, text]) => ({ path: path.replace('../src/core/', ''), text }));

/** Keywords after which a "/" starts a regex literal rather than a division. */
const RegexPrefixKeywords = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/**
 * TypeScript source with comments, string literals, template-literal text and regex literals blanked
 * out (code inside ${…} is kept), so only real code is checked.
 */
function codeOnly(source: string): string {
  let out = '';
  let i = 0;
  let last = ''; // the last significant code character or word, to tell a regex from a division
  const templateDepth: number[] = []; // brace depth at which each open ${ … } returns to template text
  let braces = 0;

  const readTemplate = (): void => {
    // At the character after ` or }: skip template text up to the closing ` or the next ${.
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') i += 2;
      else if (c === '`') {
        i++;
        out += '""';
        last = '"';
        return;
      } else if (c === '$' && source[i + 1] === '{') {
        i += 2;
        templateDepth.push(braces);
        braces++;
        out += '"" + (';
        last = '(';
        return;
      } else i++;
    }
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"') {
      i++;
      while (i < source.length && source[i] !== c && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
      i++;
      out += '""';
      last = '"';
    } else if (c === '`') {
      i++;
      readTemplate();
    } else if (c === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || RegexPrefixKeywords.has(last))) {
      // A regex literal: skip to the closing / (outside a character class), then its flags.
      i++;
      let inClass = false;
      while (i < source.length && source[i] !== '\n') {
        const r = source[i];
        if (r === '\\') i += 2;
        else {
          i++;
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
        }
      }
      while (i < source.length && /[a-z]/i.test(source[i])) i++;
      out += '/re/';
      last = '"';
    } else if (c === '{') {
      braces++;
      out += c;
      last = c;
      i++;
    } else if (c === '}') {
      braces--;
      i++;
      if (templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === braces) {
        templateDepth.pop();
        out += ') + ';
        readTemplate();
      } else {
        out += c;
        last = c;
      }
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < source.length && /[\w$]/.test(source[j])) j++;
      last = source.slice(i, j);
      out += last;
      i = j;
    } else {
      if (!/\s/.test(c)) last = c;
      out += c;
      i++;
    }
  }
  return out;
}

/** Floating-point use in code (after codeOnly): Math, parseFloat and float literals such as 0.5, .5 or 1e3. */
const FloatingPoint: readonly RegExp[] = [
  /\bMath\s*\./g,
  /\bparseFloat\b/g, // also catches Number.parseFloat
  /(?<![\w$.])\d[\d_]*\.\d/g, // 0.5
  /(?<![\w$.\d])\.\d/g, // .5
  /(?<![\w$.])\d[\d_]*(?:\.\d*)?[eE][+-]?\d/g, // 1e3, 2.5E-4
];

function floatingPointUses(source: string): string[] {
  const code = codeOnly(source);
  return FloatingPoint.flatMap((pattern) => [...code.matchAll(pattern)].map((m) => m[0]));
}

/** Every module specifier imported or re-exported by a source file. */
function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const m of source.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm)) specifiers.push(m[1]);
  for (const m of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) specifiers.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(m[1]);
  return specifiers;
}

/** True when `specifier`, imported from src/core/`fromPath`, stays inside src/core. */
function staysInCore(fromPath: string, specifier: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const parts = fromPath.split('/').slice(0, -1);
  for (const segment of specifier.split('?')[0].split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') {
      if (parts.length === 0) return false;
      parts.pop();
    } else parts.push(segment);
  }
  return true;
}

describe('architecture', () => {
  it('finds the engine sources', () => {
    const names = files.map((f) => f.path);
    for (const expected of ['rational.ts', 'units.ts', 'calcEngine.ts', 'formatter.ts', 'session.ts', 'stateStore.ts']) expect(names).toContain(expected);
    // The scanner keeps real code: no file collapses to nothing because of a mis-read literal.
    for (const f of files) expect(codeOnly(f.text), f.path).toMatch(/\bexport\b[\s\S]*\S\s*$/);
    expect(codeOnly(sources['../src/core/rational.ts'])).toContain('roundHalfAwayFromZero(): bigint');
  });

  it('the source scanner sees through comments, strings and regex literals', () => {
    expect(floatingPointUses(`const a = 'Math.sqrt(0.5)'; // parseFloat 1e3\n/* .5 */ const r = /\\d.5/g; const t = \`0.25 \${b}\`;`)).toEqual([]);
    expect(floatingPointUses('const a = Math.round(b);')).toEqual(['Math.']);
    expect(floatingPointUses('const a = Number.parseFloat(b);')).toEqual(['parseFloat']);
    for (const literal of ['0.5', '.25', '1e3', '2.5E-4', '1_000.5'])
      expect(floatingPointUses(`const a = b + ${literal};`).length, literal).toBeGreaterThan(0);
    expect(floatingPointUses('const t = `${Math.PI} and ${x / 0.5}`;')).toEqual(['Math.', '0.5']);
    expect(floatingPointUses('const x = a / 2; const y = 0x1e3 + 10n ** 3n;')).toEqual([]);
  });

  it('the engine never uses binary floating point', () => {
    const offenders = files.flatMap((f) => floatingPointUses(f.text).map((use) => `${f.path}: '${use}'`));
    expect(offenders, 'src/core must use Rational, not floating point').toEqual([]);
  });

  it('the engine has no dependencies', () => {
    const outside = files.flatMap((f) =>
      importsOf(f.text)
        .filter((s) => !staysInCore(f.path, s) || (s.includes('?') && !s.endsWith('.tsv?raw')))
        .map((s) => `${f.path}: '${s}'`),
    );
    expect(outside, 'src/core may only import src/core modules and ?raw TSV tables').toEqual([]);

    // So no runtime dependency in package.json is used by the engine.
    const runtime = Object.keys((pkg as { dependencies?: Record<string, string> }).dependencies ?? {});
    const used = files.flatMap((f) => importsOf(f.text).filter((s) => runtime.some((d) => s === d || s.startsWith(d + '/'))));
    expect(used).toEqual([]);
  });
});
