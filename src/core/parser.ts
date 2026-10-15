import { Rational } from './rational';
import { CalcError, Lexer, Token, TokenKind } from './lexer';
import { Unit, Units } from './units';

const TWELVE = Rational.of(12);

/** How to read a hyphen between feet and inches, as in 5'-6". */
export enum HyphenAfterFeet {
  /** 5'-6" is 5 ft 6 in, as written on drawings (default). */
  FeetAndInches = 'FeetAndInches',
  /** 5'-6" is 5 ft minus 6 in, for people who never type the separator. */
  Minus = 'Minus',
}

interface Span {
  start: number;
  end: number;
}

/** A number with an optional unit. Feet-and-inches like 5'6" is a single literal. */
export interface LiteralNode extends Span {
  type: 'literal';
  amount: Rational;
  unit: Unit | null;
}
export interface CompoundNode extends Span {
  type: 'compound';
  feet: LiteralNode;
  inches: LiteralNode;
}
export interface UnaryNode extends Span {
  type: 'unary';
  operand: Node;
}
export interface BinaryNode extends Span {
  type: 'binary';
  op: TokenKind;
  left: Node;
  right: Node;
}
export interface PowerNode extends Span {
  type: 'power';
  base: Node;
  exponent: number;
}
export interface PercentNode extends Span {
  type: 'percent';
  operand: Node;
}
export interface SqrtNode extends Span {
  type: 'sqrt';
  operand: Node;
}
/** @name, ans, mem or pi. */
export interface NameNode extends Span {
  type: 'name';
  name: string;
  isSavedValue: boolean;
}

export type Node = LiteralNode | CompoundNode | UnaryNode | BinaryNode | PowerNode | PercentNode | SqrtNode | NameNode;

/** Where the user asked to see the result ("… to mm", "… to ft-in"). */
export interface DisplayTarget {
  unit: Unit | null;
  feetInches: boolean;
}

export interface ParsedInput {
  root: Node;
  target: DisplayTarget | null;
}

/**
 * True when the minus at `index` is the feet-inches separator in 5'-6" rather than an operator: it
 * touches both a feet literal on its left and an inch literal on its right. This one rule drives both
 * the maths and the input highlighting, so the two can never disagree.
 */
export function isFeetInchesHyphen(t: readonly Token[], index: number, hyphen: HyphenAfterFeet): boolean {
  return (
    hyphen === HyphenAfterFeet.FeetAndInches &&
    index >= 2 &&
    index + 2 < t.length &&
    t[index].kind === TokenKind.Minus &&
    !t[index].spaceBefore &&
    t[index - 1].kind === TokenKind.Unit &&
    t[index - 1].unit === Units.Foot &&
    t[index - 2].kind === TokenKind.Number &&
    t[index + 1].kind === TokenKind.Number &&
    !t[index + 1].spaceBefore &&
    t[index + 2].kind === TokenKind.Unit &&
    t[index + 2].unit === Units.Inch
  );
}

/**
 * Recursive-descent parser. Grammar, loosest binding first:
 *
 *     input    := expr [ ('to' | 'as' | '->') target ]
 *     expr     := term (('+' | '-') term)*
 *     term     := unary (('*' | 'x' | '/') unary)*
 *     unary    := ('-' | '+') unary | power
 *     power    := postfix [ '^' ['-'] integer ]
 *     postfix  := primary ('%' | '²' | '³')*
 *     primary  := measure | '(' expr ')' | @name | ans | mem | pi | sqrt postfix
 *     measure  := number [unit] [ ['-'] number inch-unit ]   (the second part only after feet)
 *
 * In 5'-6" a hyphen touching both sides is the architectural feet-inches separator (5 ft 6 in)
 * unless HyphenAfterFeet.Minus is chosen. Subtraction with spaces, 5' - 6", is always subtraction.
 */
export class Parser {
  private p = 0;

  private constructor(
    private readonly text: string,
    private readonly tokens: Token[],
    private readonly hyphen: HyphenAfterFeet,
  ) {}

  static parse(text: string, hyphen: HyphenAfterFeet = HyphenAfterFeet.FeetAndInches): ParsedInput {
    return new Parser(text, Lexer.tokenize(text), hyphen).parseInput();
  }

  private peek(offset = 0): Token {
    const i = this.p + offset;
    return this.tokens[i < this.tokens.length ? i : this.tokens.length - 1];
  }
  private take(): Token {
    return this.tokens[this.p++];
  }
  private atKind(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private parseInput(): ParsedInput {
    if (this.atKind(TokenKind.End)) throw new CalcError('Empty', 0, 0);
    const root = this.parseExpr();
    let target: DisplayTarget | null = null;
    if (this.atKind(TokenKind.Convert)) {
      const convert = this.take();
      target = this.parseTarget(convert);
    }
    if (!this.atKind(TokenKind.End)) throw this.unexpected(this.peek());
    return { root, target };
  }

  private parseTarget(convert: Token): DisplayTarget {
    const token = this.peek();
    if (token.kind !== TokenKind.Unit) throw new CalcError("Unit needed after 'to'", convert.start, token.end);
    this.take();
    // "ft-in", "ft in", "'-\"" ask for feet-and-inches.
    if (token.unit === Units.Foot) {
      const hasHyphen = this.atKind(TokenKind.Minus);
      const next = this.peek(hasHyphen ? 1 : 0);
      if (next.kind === TokenKind.Unit && next.unit === Units.Inch) {
        this.p += hasHyphen ? 2 : 1;
        return { unit: null, feetInches: true };
      }
    }
    return { unit: token.unit ?? null, feetInches: false };
  }

  private parseExpr(): Node {
    let left = this.parseTerm();
    while (this.atKind(TokenKind.Plus) || this.atKind(TokenKind.Minus)) {
      const op = this.take().kind;
      const right = this.parseTerm();
      left = { type: 'binary', op, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseTerm(): Node {
    let left = this.parseUnary();
    while (this.atKind(TokenKind.Multiply) || this.atKind(TokenKind.Divide)) {
      const op = this.take().kind;
      const right = this.parseUnary();
      left = { type: 'binary', op, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.atKind(TokenKind.Minus) || this.atKind(TokenKind.Plus)) {
      const op = this.take();
      const operand = this.parseUnary();
      return op.kind === TokenKind.Plus ? operand : { type: 'unary', operand, start: op.start, end: operand.end };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePostfix();
    if (!this.atKind(TokenKind.Caret)) return base;
    const caret = this.take();
    let negative = false;
    if (this.atKind(TokenKind.Minus)) {
      this.take();
      negative = true;
    }
    const exponent = this.peek();
    if (exponent.kind !== TokenKind.Number || !exponent.isIntegerLiteral || exponent.value.gt(TWELVE))
      throw new CalcError('Power must be 0–12', caret.start, exponent.end);
    this.take();
    const value = Number(exponent.value.numerator);
    return { type: 'power', base, exponent: negative ? -value : value, start: base.start, end: exponent.end };
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      if (this.atKind(TokenKind.Percent)) {
        const t = this.take();
        node = { type: 'percent', operand: node, start: node.start, end: t.end };
      } else if (this.atKind(TokenKind.Superscript)) {
        const t = this.take();
        node = { type: 'power', base: node, exponent: Number(t.value.numerator), start: node.start, end: t.end };
      } else return node;
    }
  }

  private parsePrimary(): Node {
    const token = this.peek();
    switch (token.kind) {
      case TokenKind.Number:
        return this.parseMeasure();
      case TokenKind.LParen: {
        this.take();
        if (this.atKind(TokenKind.RParen)) throw new CalcError('Empty brackets', token.start, this.peek().end);
        const inner = this.parseExpr();
        if (!this.atKind(TokenKind.RParen)) throw new CalcError('Missing )', token.start, token.end);
        const close = this.take();
        return { ...inner, start: token.start, end: close.end };
      }
      case TokenKind.Variable:
        this.take();
        return { type: 'name', name: token.text, isSavedValue: true, start: token.start, end: token.end };
      case TokenKind.Identifier: {
        this.take();
        if (token.text === 'sqrt') {
          if (this.atKind(TokenKind.End)) throw new CalcError('Value needed after √', token.start, token.end);
          const operand = this.parsePostfix();
          return { type: 'sqrt', operand, start: token.start, end: operand.end };
        }
        return { type: 'name', name: token.text, isSavedValue: false, start: token.start, end: token.end };
      }
      case TokenKind.Unit:
        throw new CalcError(`Number needed before ${token.text}`, token.start, token.end);
      case TokenKind.End:
        throw new CalcError('Unfinished', token.start, token.end);
      default:
        throw this.unexpected(token);
    }
  }

  private parseMeasure(): Node {
    const number = this.take();
    if (!this.atKind(TokenKind.Unit)) {
      if (this.atKind(TokenKind.Number)) throw new CalcError('Missing operator', number.start, this.peek().end);
      return { type: 'literal', amount: number.value, unit: null, start: number.start, end: number.end };
    }
    const unitToken = this.take();
    const literal: LiteralNode = {
      type: 'literal',
      amount: number.value,
      unit: unitToken.unit ?? null,
      start: number.start,
      end: unitToken.end,
    };
    if (unitToken.unit !== Units.Foot) return literal;

    // Feet may be followed by inches: 5'6", 5' 6", 5 ft 6 in, or architectural 5'-6".
    const joined = isFeetInchesHyphen(this.tokens, this.p, this.hyphen);
    const offset = joined ? 1 : 0;
    const inchNumber = this.peek(offset);
    const inchUnit = this.peek(offset + 1);
    if (inchNumber.kind === TokenKind.Number && inchUnit.kind === TokenKind.Unit && inchUnit.unit === Units.Inch) {
      this.p += offset + 2;
      const inches: LiteralNode = {
        type: 'literal',
        amount: inchNumber.value,
        unit: Units.Inch,
        start: inchNumber.start,
        end: inchUnit.end,
      };
      return { type: 'compound', feet: literal, inches, start: literal.start, end: inches.end };
    }
    if (inchNumber.kind === TokenKind.Number && !joined)
      throw new CalcError('Missing unit or operator', inchNumber.start, inchNumber.end);
    return literal;
  }

  private unexpected(token: Token): CalcError {
    const raw = this.text.slice(token.start, token.end);
    switch (token.kind) {
      case TokenKind.RParen:
        return new CalcError('Extra )', token.start, token.end);
      case TokenKind.Convert:
        return new CalcError("'to' goes at the end", token.start, token.end);
      case TokenKind.Unit:
        return new CalcError(`Number needed before ${raw}`, token.start, token.end);
      case TokenKind.End:
        return new CalcError('Unfinished', token.start, token.end);
      default:
        return new CalcError(`Unexpected ${raw}`, token.start, token.end);
    }
  }
}

