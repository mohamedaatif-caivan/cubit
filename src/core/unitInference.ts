import { Lexer, Token, TokenKind } from './lexer';
import { HyphenAfterFeet, isFeetInchesHyphen } from './parser';
import { Unit, Units } from './units';

/**
 * A unit Cubit assumes for a plain number in a sum, as a desk construction calculator does:
 * in `1m + 1` the second 1 is read as 1m. `text` is inserted at `position`.
 * `numberStart` is where the plain number starts; `position` is where it ends (where the unit goes);
 * `text` is the unit as written by the first value ("m", "'", " ft").
 */
export interface AssumedUnit {
  readonly numberStart: number;
  readonly position: number;
  readonly text: string;
}

type TermKind = 'Empty' | 'Plain' | 'WithUnit' | 'Neutral' | 'Other';

class Term {
  readonly tokens: Token[] = [];
  hasGroup = false;
  terminated = false;
  /** The number touches a hyphen after feet (5'-6): too close to feet-inches to guess. */
  constructor(readonly gluedToFeet = false) {}
}

class Sum {
  readonly terms: Term[] = [new Term()];
  get current(): Term {
    return this.terms[this.terms.length - 1];
  }
}

/**
 * Finds plain numbers that take the unit of the sum they're in. The rule is deliberately narrow so it
 * never guesses: within one sum (terms joined by + or −), when the first value is a number with a unit
 * and every other value with a unit uses that same unit, each plain number after it gets that unit.
 * Mixed units (`5'6" + 2`, `1m + 1ft + 2`), a plain number first (`1 + 1m`), products and anything
 * else leave the plain number alone, so it still reports "Missing unit".
 *
 * Works on tokens, not the parse tree, so it also handles unfinished input while the user types.
 * CalcEngine.evaluate calculates the input with these units written in, so what's assumed, what's
 * shown and what's calculated can't differ.
 */
export const UnitInference = {
  find(input: string, hyphen: HyphenAfterFeet, answerUnit: Unit | null | undefined): AssumedUnit[] {
    if (input.trim().length === 0) return [];
    const tokens = Lexer.tokenizePartial(input);
    const found: AssumedUnit[] = [];
    const stack: Sum[] = [new Sum()];
    const top = (): Sum => stack[stack.length - 1];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      switch (token.kind) {
        case TokenKind.End:
        case TokenKind.Convert:
          while (stack.length > 0) resolve(stack.pop()!, true, answerUnit, found);
          return ordered(found);
        case TokenKind.LParen:
          top().current.hasGroup = true;
          stack.push(new Sum());
          break;
        case TokenKind.RParen:
          if (stack.length > 1) resolve(stack.pop()!, true, answerUnit, found);
          else top().current.hasGroup = true; // unmatched: the parser reports it
          break;
        default:
          if ((token.kind === TokenKind.Plus || token.kind === TokenKind.Minus) && isBinary(tokens, i) && !isFeetInchesHyphen(tokens, i, hyphen)) {
            const sum = top();
            sum.current.terminated = true;
            sum.terms.push(new Term(isGluedToFeet(tokens, i)));
          } else top().current.tokens.push(token);
      }
    }
    // The text stopped at something unreadable (e.g. "1m + 1f" while typing "ft"): the last value is unfinished.
    while (stack.length > 0) resolve(stack.pop()!, false, answerUnit, found);
    return ordered(found);
  },

  /** The input with each assumed unit written in. */
  apply(input: string, assumed: readonly AssumedUnit[]): string {
    let text = input;
    for (let i = assumed.length - 1; i >= 0; i--)
      text = text.slice(0, assumed[i].position) + assumed[i].text + text.slice(assumed[i].position);
    return text;
  },

  /** Maps a position in the text with units written in back to the user's input. */
  toInputPosition(position: number, assumed: readonly AssumedUnit[]): number {
    let shift = 0;
    for (const a of assumed) {
      const at = a.position + shift;
      if (position <= at) break;
      if (position < at + a.text.length) return a.position;
      shift += a.text.length;
    }
    return position - shift;
  },

  /** How a unit is written when Cubit adds it: marks for feet and inches, symbols otherwise. */
  spelling(unit: Unit): string {
    return unit === Units.Foot ? "'" : unit === Units.Inch ? '"' : unit.symbol;
  },
};

const ordered = (found: AssumedUnit[]): AssumedUnit[] => [...found].sort((a, b) => a.position - b.position);

function resolve(sum: Sum, terminated: boolean, answerUnit: Unit | null | undefined, found: AssumedUnit[]): void {
  sum.current.terminated ||= terminated;
  let unit: Unit | null = null;
  let spelling: string | null = null;
  const plain: Term[] = [];
  for (const term of sum.terms) {
    const c = classify(term, answerUnit);
    switch (c.kind) {
      case 'Empty':
      case 'Neutral':
        continue;
      case 'Other':
        return;
      case 'Plain':
        if (unit === null) return; // a plain number before any unit: nothing to follow
        plain.push(term);
        break;
      case 'WithUnit':
        if (unit === null) [unit, spelling] = [c.unit!, c.spelling!];
        else if (c.unit !== unit) return; // mixed units: be explicit
        break;
    }
  }
  if (unit === null || spelling === null) return;
  for (const term of plain) {
    if (!term.terminated || term.gluedToFeet) continue;
    const number = term.tokens[term.tokens.length - 1];
    found.push({ numberStart: number.start, position: number.end, text: spelling });
  }
}

function classify(term: Term, answerUnit: Unit | null | undefined): { kind: TermKind; unit?: Unit; spelling?: string } {
  if (term.hasGroup) return { kind: 'Other' };
  const t = term.tokens;
  let s = 0;
  while (s < t.length && (t[s].kind === TokenKind.Plus || t[s].kind === TokenKind.Minus)) s++; // signs: -1, +2
  const rest = t.length - s;
  if (rest === 0) return { kind: t.length === 0 ? 'Empty' : 'Other' };
  const first = t[s];
  if (rest === 1 && first.kind === TokenKind.Number) return { kind: 'Plain' };
  if (rest === 2 && first.kind === TokenKind.Number && t[s + 1].kind === TokenKind.Percent) return { kind: 'Neutral' };
  if (rest === 2 && first.kind === TokenKind.Number && t[s + 1].kind === TokenKind.Unit) {
    const unitToken = t[s + 1];
    const spelling = unitToken.text === "'" || unitToken.text === '"' ? unitToken.text : (unitToken.spaceBefore ? ' ' : '') + unitToken.text;
    return { kind: 'WithUnit', unit: unitToken.unit, spelling };
  }
  if (rest === 1 && first.kind === TokenKind.Identifier && first.text === 'ans' && answerUnit)
    return { kind: 'WithUnit', unit: answerUnit, spelling: UnitInference.spelling(answerUnit) };
  return { kind: 'Other' };
}

/** A + or − joins two terms when it follows a value; otherwise it's a sign (2 × -3). */
function isBinary(t: readonly Token[], i: number): boolean {
  if (i <= 0) return false;
  const k = t[i - 1].kind;
  return (
    k === TokenKind.Number ||
    k === TokenKind.Unit ||
    k === TokenKind.RParen ||
    k === TokenKind.Identifier ||
    k === TokenKind.Variable ||
    k === TokenKind.Percent ||
    k === TokenKind.Superscript
  );
}

function isGluedToFeet(t: readonly Token[], i: number): boolean {
  return (
    t[i].kind === TokenKind.Minus &&
    !t[i].spaceBefore &&
    i > 0 &&
    t[i - 1].kind === TokenKind.Unit &&
    t[i - 1].unit === Units.Foot &&
    i + 1 < t.length &&
    t[i + 1].kind === TokenKind.Number &&
    !t[i + 1].spaceBefore
  );
}
