import { Rational } from './rational';
import { Unit, Units } from './units';

/** An input problem, with the character range to highlight. */
export class CalcError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message);
  }
}

export enum TokenKind {
  Number = 'Number',
  Unit = 'Unit',
  Plus = 'Plus',
  Minus = 'Minus',
  Multiply = 'Multiply',
  Divide = 'Divide',
  Caret = 'Caret',
  Superscript = 'Superscript',
  Percent = 'Percent',
  LParen = 'LParen',
  RParen = 'RParen',
  Variable = 'Variable',
  Identifier = 'Identifier',
  Convert = 'Convert',
  End = 'End',
}

export interface Token {
  readonly kind: TokenKind;
  readonly start: number;
  readonly end: number;
  readonly spaceBefore: boolean;
  readonly value: Rational;
  readonly isIntegerLiteral: boolean;
  readonly unit?: Unit;
  readonly text: string;
}

const InchMarks = '"″”“';
const FootMarks = "'′’‘";
const InchWords = ['in', 'inch', 'inches'];

const isAsciiDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isLetter = (c: string | undefined): boolean => c !== undefined && /\p{L}/u.test(c);
const isWhiteSpace = (c: string | undefined): boolean => c !== undefined && /\s/u.test(c);
const isAsciiLetterOrDigit = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9]/.test(c);
/** Spaces inside a mixed number: normal, tab, and the en/thin spaces Cubit uses on screen. */
const isInlineSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === ' ' || c === ' ' || c === ' ' || c === ' ' || c === ' ';

function token(kind: TokenKind, start: number, end: number, spaceBefore: boolean, extra: Partial<Token> = {}): Token {
  return { kind, start, end, spaceBefore, value: Rational.Zero, isIntegerLiteral: false, text: '', ...extra };
}

/**
 * Turns calculator input into tokens. Number literals absorb construction fraction notation so the
 * parser always sees one value: `1/2`, `3 1/2` and `6-1/2"` are each a single number.
 */
export class Lexer {
  private i = 0;

  private constructor(private readonly s: string) {}

  /** Tokens up to the first character that can't be read, for highlighting unfinished input. */
  static tokenizePartial(text: string): Token[] {
    const lexer = new Lexer(text);
    const tokens: Token[] = [];
    try {
      let t: Token;
      do tokens.push((t = lexer.next()));
      while (t.kind !== TokenKind.End);
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
    }
    return tokens;
  }

  static tokenize(text: string): Token[] {
    const lexer = new Lexer(text);
    const tokens: Token[] = [];
    let t: Token;
    do tokens.push((t = lexer.next()));
    while (t.kind !== TokenKind.End);
    return tokens;
  }

  private next(): Token {
    const s = this.s;
    const spaceStart = this.i;
    while (this.i < s.length && isWhiteSpace(s[this.i])) this.i++;
    const space = this.i > spaceStart || this.i === 0;
    if (this.i >= s.length) return token(TokenKind.End, s.length, s.length, space);

    const start = this.i;
    const c = s[this.i];
    if (isAsciiDigit(c) || (c === '.' && isAsciiDigit(s[this.i + 1]))) return this.lexNumber(space);
    if (InchMarks.includes(c)) {
      this.i++;
      return token(TokenKind.Unit, start, this.i, space, { unit: Units.Inch, text: '"' });
    }
    if (FootMarks.includes(c)) {
      this.i++;
      return token(TokenKind.Unit, start, this.i, space, { unit: Units.Foot, text: "'" });
    }
    if ((c === '-' || c === '−' || c === '–') && s[this.i + 1] === '>') {
      this.i += 2;
      return token(TokenKind.Convert, start, this.i, space);
    }

    this.i++;
    const simple = (kind: TokenKind, extra: Partial<Token> = {}): Token =>
      token(kind, start, this.i, space, { text: s.slice(start, this.i), ...extra });
    switch (c) {
      case '+':
        return simple(TokenKind.Plus);
      case '-':
      case '−':
      case '–':
        return simple(TokenKind.Minus);
      case '*':
      case '×':
      case '⋅':
        return simple(TokenKind.Multiply);
      case '/':
      case '÷':
        return simple(TokenKind.Divide);
      case '^':
        return simple(TokenKind.Caret);
      case '%':
        return simple(TokenKind.Percent);
      case '(':
      case '[':
        return simple(TokenKind.LParen);
      case ')':
      case ']':
        return simple(TokenKind.RParen);
      case '→':
        return simple(TokenKind.Convert);
      case '²':
        return simple(TokenKind.Superscript, { value: Rational.of(2) });
      case '³':
        return simple(TokenKind.Superscript, { value: Rational.of(3) });
      case 'π':
        return simple(TokenKind.Identifier, { text: 'pi' });
      case '√':
        return simple(TokenKind.Identifier, { text: 'sqrt' });
      case '@':
        return this.lexVariable(start, space);
    }
    if (isLetter(c)) {
      this.i = start;
      return this.lexWord(space);
    }
    throw new CalcError(`Unknown symbol ${c}`, start, start + 1);
  }

  private lexVariable(start: number, space: boolean): Token {
    const s = this.s;
    const nameStart = this.i;
    while (this.i < s.length && (isAsciiLetterOrDigit(s[this.i]) || s[this.i] === '_')) this.i++;
    if (this.i === nameStart) throw new CalcError('Name needed after @', start, this.i);
    return token(TokenKind.Variable, start, this.i, space, { text: s.slice(nameStart, this.i) });
  }

  private lexWord(space: boolean): Token {
    const s = this.s;
    const start = this.i;
    const word = this.readUnitWord();
    const lower = word.toLowerCase();
    switch (lower) {
      case 'x':
        return token(TokenKind.Multiply, start, this.i, space, { text: word });
      case 'to':
      case 'as':
        return token(TokenKind.Convert, start, this.i, space, { text: word });
      case 'ans':
      case 'pi':
      case 'sqrt':
      case 'mem':
        return token(TokenKind.Identifier, start, this.i, space, { text: lower });
      case 'sq':
      case 'square':
      case 'cu':
      case 'cubic': {
        const power = lower.startsWith('s') ? 2 : 3;
        const save = this.i;
        while (this.i < s.length && (isWhiteSpace(s[this.i]) || s[this.i] === '.')) this.i++;
        const lengthWord = this.i < s.length && isLetter(s[this.i]) ? this.readUnitWord() : '';
        const length = Units.find(lengthWord);
        const raised = length ? Units.raise(length, power) : undefined;
        if (raised) return token(TokenKind.Unit, start, this.i, space, { unit: raised, text: s.slice(start, this.i) });
        this.i = save;
        throw new CalcError(`Unit needed after ${word}`, start, this.i);
      }
    }
    const unit = Units.find(word);
    if (unit) return token(TokenKind.Unit, start, this.i, space, { unit, text: word });
    throw new CalcError(`Unknown unit '${word}'`, start, this.i);
  }

  /** Reads letters, plus a trailing 2/3/²/³ when that makes a known unit (ft2, m³). */
  private readUnitWord(): string {
    const s = this.s;
    const start = this.i;
    while (this.i < s.length && isLetter(s[this.i])) this.i++;
    let word = s.slice(start, this.i);
    const c = s[this.i];
    if (
      (c === '2' || c === '3' || c === '²' || c === '³') &&
      Units.find(word + c) !== undefined &&
      !isAsciiDigit(s[this.i + 1])
    ) {
      this.i++;
      word = s.slice(start, this.i);
    }
    return word;
  }

  private lexNumber(space: boolean): Token {
    const s = this.s;
    const start = this.i;
    let { value, isInteger } = this.readDecimal();
    if (isInteger && this.at('/') && isAsciiDigit(s[this.i + 1])) {
      this.i++;
      value = value.div(this.readDenominator(start));
      return token(TokenKind.Number, start, this.i, space, { value, text: s.slice(start, this.i) });
    }
    if (isInteger) {
      const fraction = this.tryMixedFraction();
      if (fraction) value = value.add(fraction);
    }
    return token(TokenKind.Number, start, this.i, space, {
      value,
      isIntegerLiteral: isInteger && value.isInteger,
      text: s.slice(start, this.i),
    });
  }

  /**
   * After a whole number, absorbs "␣a/b" (3 1/2) or "-a/b" when an inch mark follows (6-1/2").
   * Leaves the position unchanged when the text isn't a mixed number.
   */
  private tryMixedFraction(): Rational | null {
    const s = this.s;
    let j = this.i;
    let hyphen: boolean;
    if (s[j] === '-') {
      hyphen = true;
      j++;
    } else {
      hyphen = false;
      if (j >= s.length || !isInlineSpace(s[j])) return null;
      while (j < s.length && isInlineSpace(s[j])) j++;
    }
    const numStart = j;
    while (j < s.length && isAsciiDigit(s[j])) j++;
    if (j === numStart || j >= s.length || s[j] !== '/') return null;
    const numerator = s.slice(numStart, j);
    const denStart = ++j;
    while (j < s.length && isAsciiDigit(s[j])) j++;
    if (j === denStart) return null;
    if (j < s.length && (s[j] === '.' || s[j] === '/')) return null;
    if (hyphen && !this.inchMarkAt(j)) return null;
    const denominator = Rational.parse(s.slice(denStart, j));
    if (denominator.isZero) throw new CalcError("Fraction can't be /0", denStart, j);
    this.i = j;
    return Rational.parse(numerator).div(denominator);
  }

  private inchMarkAt(j: number): boolean {
    const s = this.s;
    while (j < s.length && s[j] === ' ') j++;
    if (j >= s.length) return false;
    if (InchMarks.includes(s[j])) return true;
    let k = j;
    while (k < s.length && isLetter(s[k])) k++;
    if (k < s.length && (isAsciiDigit(s[k]) || s[k] === '²' || s[k] === '³')) return false;
    return InchWords.includes(s.slice(j, k).toLowerCase());
  }

  private readDecimal(): { value: Rational; isInteger: boolean } {
    const s = this.s;
    const start = this.i;
    let digits = '';
    let groupLength = 0;
    while (this.i < s.length && isAsciiDigit(s[this.i])) {
      digits += s[this.i++];
      groupLength++;
    }
    // Thousands separators: 1,250 or 12,500,000 (leading group 1–3 digits, then groups of exactly 3).
    const leadingGroupOk = groupLength > 0 && groupLength <= 3;
    while (
      leadingGroupOk &&
      this.at(',') &&
      isAsciiDigit(s[this.i + 1]) &&
      isAsciiDigit(s[this.i + 2]) &&
      isAsciiDigit(s[this.i + 3]) &&
      !isAsciiDigit(s[this.i + 4])
    ) {
      digits += s.slice(this.i + 1, this.i + 4);
      this.i += 4;
    }
    let isInteger = true;
    if (this.at('.')) {
      isInteger = false;
      digits += '.';
      this.i++;
      while (this.i < s.length && isAsciiDigit(s[this.i])) digits += s[this.i++];
      if (this.at('.')) throw new CalcError('Too many decimal points', start, this.i + 1);
    }
    return { value: Rational.parse(digits), isInteger };
  }

  private readDenominator(literalStart: number): Rational {
    const s = this.s;
    const start = this.i;
    while (this.i < s.length && isAsciiDigit(s[this.i])) this.i++;
    const denominator = Rational.parse(s.slice(start, this.i));
    if (denominator.isZero) throw new CalcError("Fraction can't be /0", literalStart, this.i);
    if (this.at('.')) throw new CalcError('Fractions need whole numbers', literalStart, this.i + 1);
    return denominator;
  }

  private at(c: string): boolean {
    return this.s[this.i] === c;
  }
}
