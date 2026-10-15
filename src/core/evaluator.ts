import { Rational } from './rational';
import { CalcError, TokenKind } from './lexer';
import { HyphenAfterFeet, type BinaryNode, type Node, type PercentNode } from './parser';
import { MaxPower, Quantity, quantity } from './quantity';
import type { Unit } from './units';

/** Values the expression can refer to by name. */
export interface EvaluationContext {
  /** Saved values by lower-case name. */
  savedValues?: ReadonlyMap<string, Quantity>;
  answer?: Quantity | null;
  memory?: Quantity | null;
  hyphenAfterFeet?: HyphenAfterFeet;
  /** Plain numbers in a sum take its unit: 1m + 1 = 2 m (see unitInference). Default true. */
  assumeUnits?: boolean;
  /** The unit the last answer is shown in, so "ans + 1" follows it. Null for feet-inches and plain numbers. */
  answerUnit?: Unit | null;
}

export const EmptyContext: EvaluationContext = {};

const negate = (q: Quantity): Quantity => quantity(q.si.neg(), q.power, q.exact);
const addQ = (a: Quantity, b: Quantity): Quantity => quantity(a.si.add(b.si), a.power, a.exact && b.exact);
const HUNDRED = Rational.of(100);

/**
 * Evaluates a parsed expression with exact rational arithmetic and dimension checking
 * (length × length = area, area ÷ length = length, length + area is an error).
 */
export class Evaluator {
  constructor(private readonly context: EvaluationContext) {}

  evaluate(node: Node): Quantity {
    switch (node.type) {
      case 'literal':
        return node.unit === null ? Quantity.number(node.amount) : Quantity.of(node.amount, node.unit);
      case 'compound':
        return addQ(this.evaluate(node.feet), this.evaluate(node.inches));
      case 'unary':
        return negate(this.evaluate(node.operand));
      case 'binary':
        return this.binary(node);
      case 'power': {
        const value = this.evaluate(node.base);
        const power = value.power * node.exponent;
        if (power < 0 || power > MaxPower) throw new CalcError('Too many dimensions', node.start, node.end);
        if (node.exponent < 0 && value.si.isZero) throw new CalcError('Divide by zero', node.start, node.end);
        return quantity(value.si.pow(node.exponent), power, value.exact);
      }
      case 'percent':
        return this.percent(node);
      case 'sqrt': {
        const value = this.evaluate(node.operand);
        if (value.power % 2 !== 0) throw new CalcError(`Can't √ ${Quantity.withArticle(value.power)}`, node.start, node.end);
        if (value.si.sign < 0) throw new CalcError("Can't √ a negative", node.start, node.end);
        const root = Rational.sqrt(value.si);
        return quantity(root.value, value.power / 2, value.exact && root.exact);
      }
      case 'name':
        return this.name(node.name, node.isSavedValue, node.start, node.end);
    }
  }

  private binary(b: BinaryNode): Quantity {
    // Desk-calculator percent: X + 10% is X × 1.10 and X − 25% is X × 0.75 (waste, discounts).
    if ((b.op === TokenKind.Plus || b.op === TokenKind.Minus) && b.right.type === 'percent') {
      const baseValue = this.evaluate(b.left);
      const rate = this.percent(b.right);
      const factor = b.op === TokenKind.Plus ? Rational.One.add(rate.si) : Rational.One.sub(rate.si);
      return quantity(baseValue.si.mul(factor), baseValue.power, baseValue.exact && rate.exact);
    }
    const left = this.evaluate(b.left);
    const right = this.evaluate(b.right);
    const exact = left.exact && right.exact;
    switch (b.op) {
      case TokenKind.Plus:
      case TokenKind.Minus: {
        if (left.power !== right.power) throw mismatchedAdd(b, left, right);
        const si = b.op === TokenKind.Plus ? left.si.add(right.si) : left.si.sub(right.si);
        return quantity(si, left.power, exact);
      }
      case TokenKind.Multiply: {
        const power = left.power + right.power;
        if (power > MaxPower) throw new CalcError('Too many dimensions', b.start, b.end);
        return quantity(left.si.mul(right.si), power, exact);
      }
      default: {
        if (right.si.isZero) throw new CalcError('Divide by zero', b.right.start, b.right.end);
        const power = left.power - right.power;
        if (power < 0)
          throw new CalcError(`Can't divide ${Quantity.describe(left.power)} by ${Quantity.describe(right.power)}`, b.start, b.end);
        return quantity(left.si.div(right.si), power, exact);
      }
    }
  }

  private percent(node: PercentNode): Quantity {
    const value = this.evaluate(node.operand);
    if (value.power !== 0) throw new CalcError('% needs a plain number', node.start, node.end);
    return quantity(value.si.div(HUNDRED), value.power, value.exact);
  }

  private name(name: string, isSavedValue: boolean, start: number, end: number): Quantity {
    if (isSavedValue) {
      const saved = this.context.savedValues?.get(name.toLowerCase());
      if (!saved) throw new CalcError(`No saved value @${name}`, start, end);
      return saved;
    }
    switch (name) {
      case 'pi':
        return quantity(Rational.Pi, 0, false);
      case 'ans':
        if (!this.context.answer) throw new CalcError('No answer yet', start, end);
        return this.context.answer;
      case 'mem':
        if (!this.context.memory) throw new CalcError('Memory empty', start, end);
        return this.context.memory;
      default:
        throw new CalcError(`Unknown name '${name}'`, start, end);
    }
  }
}

function mismatchedAdd(b: BinaryNode, left: Quantity, right: Quantity): CalcError {
  if (left.power === 0 || right.power === 0) {
    const plain = left.power === 0 ? b.left : b.right;
    return new CalcError('Missing unit', plain.start, plain.end);
  }
  const verb = b.op === TokenKind.Plus ? 'add' : 'subtract';
  return new CalcError(`Can't ${verb} ${Quantity.describe(left.power)} and ${Quantity.describe(right.power)}`, b.start, b.end);
}

export { HyphenAfterFeet };
