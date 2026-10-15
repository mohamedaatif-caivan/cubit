import { DivideByZeroError } from './rational';
import { CalcError, Lexer, TokenKind } from './lexer';
import { HyphenAfterFeet, Parser, isFeetInchesHyphen } from './parser';
import { EmptyContext, EvaluationContext, Evaluator } from './evaluator';
import { AssumedUnit, UnitInference } from './unitInference';
import { DisplayFormat, Formats } from './formats';
import { Quantity } from './quantity';

/** The outcome of evaluating one line of input. */
export interface CalcResult {
  readonly value: Quantity | null;
  /** Set when the input ended with "to unit". */
  readonly requestedFormat: DisplayFormat | null;
  readonly error: string | null;
  readonly errorStart: number;
  readonly errorEnd: number;
  /** Units assumed for plain numbers ("1m + 1" reads as "1m + 1m"), found even when the input has an error. */
  readonly assumed: readonly AssumedUnit[];
  /** The input as calculated: with `assumed` written in. */
  readonly calculated: string;
}

export const EmptyResult: CalcResult = {
  value: null,
  requestedFormat: null,
  error: null,
  errorStart: 0,
  errorEnd: 0,
  assumed: [],
  calculated: '',
};

export const isSuccess = (r: CalcResult): boolean => r.value !== null;

export type HighlightKind = 'Operator';

/** A character range of the input to colour. */
export interface HighlightSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: HighlightKind;
}

const isBlank = (s: string | null | undefined): s is null | undefined | '' => s == null || s.trim().length === 0;

/** Entry point: text in, exact quantity (or a precise error) out. Pure. */
export const CalcEngine = {
  /**
   * The operators in `input` (+ − × ÷ ^ % and "to"), using the same token decisions as evaluate: the
   * hyphen in 5'-6" is reported as an operator only when it subtracts. Works on unfinished input too.
   */
  highlight(input: string | null | undefined, hyphen: HyphenAfterFeet = HyphenAfterFeet.FeetAndInches): HighlightSpan[] {
    if (!input) return [];
    const tokens = Lexer.tokenizePartial(input);
    const spans: HighlightSpan[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      let isOperator: boolean;
      switch (t.kind) {
        case TokenKind.Plus:
        case TokenKind.Multiply:
        case TokenKind.Divide:
        case TokenKind.Caret:
        case TokenKind.Percent:
        case TokenKind.Convert:
          isOperator = true;
          break;
        case TokenKind.Minus:
          isOperator = !isFeetInchesHyphen(tokens, i, hyphen);
          break;
        default:
          isOperator = false;
      }
      if (isOperator) spans.push({ start: t.start, end: t.end, kind: 'Operator' });
    }
    return spans;
  },

  /** The units evaluate assumes for plain numbers in `input`. */
  assumedUnits(input: string | null | undefined, context: EvaluationContext = EmptyContext): AssumedUnit[] {
    return (context.assumeUnits ?? true) && !isBlank(input)
      ? UnitInference.find(input!, context.hyphenAfterFeet ?? HyphenAfterFeet.FeetAndInches, context.answerUnit)
      : [];
  },

  /**
   * Calculates `input`. Plain numbers in a sum take the sum's unit first (see assumedUnits); the result
   * lists them, and error positions refer to the input as typed.
   */
  evaluate(input: string | null | undefined, context: EvaluationContext = EmptyContext): CalcResult {
    if (isBlank(input)) return EmptyResult;
    const assumed = CalcEngine.assumedUnits(input, context);
    const calculated = UnitInference.apply(input!, assumed);
    let result = evaluateExplicit(calculated, context);
    if (result.error !== null && assumed.length > 0) {
      const start = UnitInference.toInputPosition(result.errorStart, assumed);
      const end = UnitInference.toInputPosition(result.errorEnd, assumed);
      result = { ...result, errorStart: start, errorEnd: end > start ? end : start };
    }
    return { ...result, assumed, calculated };
  },
};

function evaluateExplicit(input: string, context: EvaluationContext): CalcResult {
  try {
    const parsed = Parser.parse(input, context.hyphenAfterFeet ?? HyphenAfterFeet.FeetAndInches);
    const value = new Evaluator(context).evaluate(parsed.root);
    let format: DisplayFormat | null = null;
    if (parsed.target) {
      const target = parsed.target;
      format = (target.feetInches ? Formats.FeetInches : Formats.forUnit(target.unit!)) ?? null;
      if (format === null || format.power !== value.power) {
        const targetText = target.feetInches ? 'ft-in' : target.unit!.symbol;
        const s = input.lastIndexOf(' ');
        return {
          ...EmptyResult,
          error: `Can't show ${Quantity.describe(value.power)} in ${targetText}`,
          errorStart: s >= 0 ? s + 1 : 0,
          errorEnd: input.length,
        };
      }
    }
    return { ...EmptyResult, value, requestedFormat: format };
  } catch (e) {
    if (e instanceof CalcError) return { ...EmptyResult, error: e.message, errorStart: e.start, errorEnd: e.end > e.start ? e.end : e.start };
    if (e instanceof DivideByZeroError) return { ...EmptyResult, error: 'Divide by zero', errorStart: 0, errorEnd: input.length };
    throw e;
  }
}
