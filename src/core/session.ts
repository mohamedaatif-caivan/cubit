import { Rational, RoundingMode } from './rational';
import { CalcEngine, CalcResult, EmptyResult, HighlightSpan } from './calcEngine';
import { CopyPreset, CopyPresets } from './copyPreset';
import type { EvaluationContext } from './evaluator';
import { DisplayFormat, FormatStyle, Formats } from './formats';
import { Formatter } from './formatter';
import { Lexer, TokenKind } from './lexer';
import { HyphenAfterFeet } from './parser';
import { Quantity, quantity } from './quantity';
import type { AssumedUnit } from './unitInference';
import { AppState, SavedValue, Settings, TapeEntry } from './appState';
import { Unit, Units } from './units';

/** One unit in the "every unit at once" panel. */
export interface TileModel {
  readonly format: DisplayFormat;
  readonly value: string;
  readonly isPrimary: boolean;
  readonly isApprox: boolean;
}

/**
 * `text`: the result as written ("8'-1 1/4"", "1,676.4 mm").
 * `screenText`: the same for the big display, with a wider space before fractions so 8'-1 1/4" can't read as 8'-11/4".
 * `caption`: what the result is and how it was rounded ("Feet-inches · rounded to nearest 1/16″").
 */
export interface ResultDisplay {
  readonly value: Quantity;
  readonly format: DisplayFormat;
  readonly text: string;
  readonly screenText: string;
  readonly isApprox: boolean;
  readonly caption: string;
  readonly tiles: readonly TileModel[];
}

/** A faint unit drawn after the end of the input ("1m + 1" shows a faint m after the last 1). */
export interface GhostUnit {
  readonly position: number;
  readonly text: string;
}

/**
 * Assumed units around the caret: `write` are settled (the user has moved past the number) and belong
 * in the input; `ghost` is the number still being typed, shown as a faint hint at the end.
 */
export interface UnitHints {
  readonly write: readonly AssumedUnit[];
  readonly ghost: GhostUnit | null;
}

export const NoHints: UnitHints = { write: [], ghost: null };

/** Something deleted that can be brought back with undo(). */
export interface UndoRecord {
  readonly description: string;
  readonly restore: () => void;
}

const isBlank = (s: string): boolean => s.trim().length === 0;
/**
 * Everything the calculator screen does, without any UI: evaluating input, keeping the last good result
 * on screen (marked stale) while the input has an error, committing to the tape, copy rules, saved
 * values, memory, notes and undo. The UI only adds timing and rendering, so this behaviour is covered
 * by ordinary unit tests.
 */
export class CalculatorSession {
  private _input = '';
  private _result: CalcResult = EmptyResult;
  private answerFormat: DisplayFormat | undefined;

  /** The value on screen: the live result, the last good one while the input has an error, or the last answer. */
  display: ResultDisplay | null = null;
  /** The input has an error, so `shown` is a previous value that must not be copied or saved. */
  isStale = false;
  highlights: HighlightSpan[] = [];
  answer: Quantity | null = null;
  answerInput = '';
  answerHyphen: HyphenAfterFeet = HyphenAfterFeet.FeetAndInches;
  lastUndo: UndoRecord | null = null;

  constructor(readonly state: AppState) {
    const last = state.tape[state.tape.length - 1];
    if (last) this.setAnswer(last);
    this.refresh();
  }

  get settings(): Settings {
    return this.state.settings;
  }

  // ---------------- Input and result ----------------

  get input(): string {
    return this._input;
  }
  get isTyping(): boolean {
    return !isBlank(this._input);
  }
  get result(): CalcResult {
    return this._result;
  }
  get shown(): Quantity | null {
    return this.display?.value ?? null;
  }

  /** The short reason the input can't be calculated ("Missing unit"), or null. */
  get error(): string | null {
    return this.isTyping ? this._result.error : null;
  }

  /** The input range to underline for `error`; the last character when the error has no position. */
  get errorRange(): { start: number; end: number } | null {
    if (this.error === null) return null;
    if (this._result.errorEnd > this._result.errorStart) return { start: this._result.errorStart, end: this._result.errorEnd };
    const last = this._input.trimEnd().length - 1;
    return last >= 0 ? { start: last, end: last + 1 } : null;
  }

  /** "5'6 1/2" + 1.2m =" above the answer once the input is cleared after Enter. */
  get echo(): string {
    return !this.isTyping && this.answer !== null ? this.answerInput + ' =' : '';
  }
  get echoSpans(): HighlightSpan[] {
    return this.echo.length > 0 ? CalcEngine.highlight(this.answerInput, this.answerHyphen) : [];
  }

  /** How the answer shows now: as calculated while the answer follows the input, otherwise the chosen unit. */
  get answerDisplayFormat(): DisplayFormat | null {
    const a = this.answer;
    if (a === null) return null;
    const f = this.answerFormat;
    if (this.settings.answerFollowsInput && f && f.power === a.power) return f;
    return this.settings.primaryFor(a.power);
  }

  get context(): EvaluationContext {
    const f = this.answerDisplayFormat;
    return {
      savedValues: this.state.savedLookup,
      answer: this.answer,
      memory: this.state.memory,
      hyphenAfterFeet: this.settings.hyphenAfterFeet,
      assumeUnits: this.settings.assumeUnits,
      // "ans + 1" follows the unit the answer is shown in; feet-inches is two units, so it doesn't.
      answerUnit: f && (f.style === FormatStyle.Decimal || f.style === FormatStyle.FractionalInches) ? f.unit : null,
    };
  }

  setInput(text: string | null | undefined): void {
    this._input = text ?? '';
    this.refresh();
  }

  /** Re-evaluates the current input, e.g. after a setting or saved value changed. */
  refresh(): void {
    this.highlights = CalcEngine.highlight(this._input, this.settings.hyphenAfterFeet);
    if (!this.isTyping) {
      this._result = EmptyResult;
      this.isStale = false;
      this.display = this.answer !== null ? this.buildDisplay(this.answer, this.answerDisplayFormat!) : null;
      return;
    }
    this._result = CalcEngine.evaluate(this._input, this.context);
    if (this._result.value !== null) {
      this.isStale = false;
      this.display = this.buildDisplay(this._result.value, this._result.requestedFormat ?? this.formatFor(this._result.value, this._result.calculated));
    } else {
      // Keep the last good value on screen, marked stale.
      this.isStale = this.display !== null;
    }
  }

  /**
   * The format for a result: the unit picked in the tiles, or, while the answer follows the input, the
   * first unit typed (1m + 1 shows metres). A result in another dimension stays in that unit's system
   * (3m x 4m shows m², 20' x 30' x 4" shows your imperial volume unit).
   */
  formatFor(q: Quantity, calculated: string): DisplayFormat {
    if (q.power === 0) return Formats.Number;
    if (!this.settings.answerFollowsInput) return this.settings.primaryFor(q.power);
    const primary = this.settings.primaryFor(q.power);
    const { unit, ans } = firstValue(calculated);
    if (unit && unit.power === q.power) {
      if (unit === Units.Foot) return primary === Formats.DecimalFeet ? primary : Formats.FeetInches;
      if (unit === Units.Inch) return primary === Formats.DecimalInches ? primary : Formats.Inches;
      return Formats.forUnit(unit) ?? primary;
    }
    if (unit) return this.settings.preferredFor(q.power, unit.system);
    const answer = this.answerDisplayFormat;
    if (ans && answer) {
      if (answer.power === q.power) return answer;
      const system = Settings.systemOf(answer);
      if (system !== null) return this.settings.preferredFor(q.power, system);
    }
    return primary;
  }

  private buildDisplay(q: Quantity, primary: DisplayFormat): ResultDisplay {
    const precision = this.settings.precisionFor(primary);
    const formatted = Formatter.format(q, primary, precision, RoundingMode.Nearest, true);
    const screen = primary.isFractional ? formatted.text.replace(/(\d) (\d+\/\d+)/g, '$1 $2') : formatted.text;
    const caption = !q.exact
      ? `${primary.label} · approximate (uses √ or π)`
      : formatted.isExact
        ? `${primary.label} · exact`
        : `${primary.label} · rounded to nearest ${CalculatorSession.incrementText(primary, precision)}`;
    const visible = this.settings.visibleFormats(q.power);
    const tiles =
      q.power === 0
        ? []
        : Formats.forPower(q.power)
            .filter((f) => f.id === primary.id || visible.includes(f))
            .map((f): TileModel => {
              const v = Formatter.format(q, f, this.settings.precisionFor(f), RoundingMode.Nearest, true);
              return { format: f, value: v.text, isPrimary: f.id === primary.id, isApprox: !v.isExact };
            });
    return { value: q, format: primary, text: formatted.text, screenText: screen, isApprox: !formatted.isExact, caption, tiles };
  }

  static incrementText(format: DisplayFormat, precision: number): string {
    return format.isFractional
      ? precision === 1
        ? '1″'
        : `1/${precision}″`
      : `${Rational.powerOfTen(-precision).toFixed(precision)} ${format.unit?.symbol ?? ''}`.trimEnd();
  }

  /** Adds the result to the tape and makes it the answer; null (with `error` set) when the input can't be calculated. */
  commit(): TapeEntry | null {
    if (!this.isTyping) return null;
    this._result = CalcEngine.evaluate(this._input, this.context);
    const value = this._result.value;
    if (value === null) return null;
    const format = this._result.requestedFormat ?? this.formatFor(value, this._result.calculated);
    const entry: TapeEntry = {
      id: crypto.randomUUID(),
      input: this._result.calculated.trim(),
      value,
      at: new Date().toISOString(),
      note: null,
      hyphen: this.settings.hyphenAfterFeet,
      formatId: format.id,
    };
    this.state.addToTape(entry);
    this.setAnswer(entry);
    this.setInput('');
    return entry;
  }

  private setAnswer(entry: TapeEntry): void {
    this.answer = entry.value;
    this.answerInput = entry.input;
    this.answerHyphen = entry.hyphen;
    this.answerFormat = Formats.find(entry.formatId);
  }

  // ---------------- Answer unit ----------------

  /** Shows answers in `format` from now on (a tile was clicked). */
  pickUnit(format: DisplayFormat): void {
    this.settings.pickUnit(format);
    this.refresh();
  }

  /** Turns "answer in the first unit typed" on or off. */
  setAnswerFollowsInput(follow: boolean): void {
    this.settings.answerFollowsInput = follow;
    this.refresh();
  }

  // ---------------- Assumed units ----------------

  /**
   * Which assumed units belong in the input now, with the caret at `caret`. The number being typed (the
   * caret is in it or just after it) keeps its unit as a hint, drawn faintly when it's at the end of the
   * input, so 1m + 1 can still become 1m + 15 or 1m + 1ft. Once the user moves on (types + or −, moves
   * the caret), the unit is written in and becomes part of the input.
   */
  hintsAt(caret: number): UnitHints {
    if (!this.isTyping || this._result.assumed.length === 0) return NoHints;
    const input = this._input;
    const write: AssumedUnit[] = [];
    let ghost: GhostUnit | null = null;
    for (const a of this._result.assumed) {
      const typing = caret >= a.numberStart && caret <= input.length && (caret <= a.position || isBlank(input.slice(a.position, caret)));
      if (!typing) {
        write.push(a);
        continue;
      }
      if (isBlank(input.slice(a.position))) ghost = { position: input.length, text: input.length > a.position ? a.text.trimStart() : a.text };
    }
    return { write, ghost };
  }

  clearAnswer(): void {
    this.answer = null;
    this.answerInput = '';
    this.refresh();
  }

  /**
   * Typing an operator into an empty input continues from the last answer, like a desk calculator:
   * "+" becomes "ans + ". Returns the replacement text, or null to keep what was typed.
   */
  continueFromAnswer(previous: string, current: string): string | null {
    if (previous.length !== 0 || this.answer === null) return null;
    const op = current.trim();
    if (op === '²') return 'ans²';
    return ['+', '-', '−', '*', '/', 'x', '×', '÷', '^'].includes(op) ? `ans ${op} ` : null;
  }

  /** Earlier inputs, newest first, for ↑/↓ recall. */
  get history(): string[] {
    return this.state.tape.map((e) => e.input).reverse();
  }

  // ---------------- Copy ----------------

  get canCopy(): boolean {
    return !this.isStale && this.shown !== null;
  }

  /** Clipboard text for the result, or null when there's nothing current to copy. */
  copyText(preset?: CopyPreset): string | null {
    const d = this.display;
    return this.canCopy && d ? CopyPresets.format(preset ?? this.settings.copyPreset, d.value, d.format, this.settings.precisionFor) : null;
  }

  /** A tile's value: a plain number for decimal units, or with its unit when asked (Shift+click). */
  tileCopyText(format: DisplayFormat, includeUnit: boolean): string | null {
    const q = this.shown;
    if (!this.canCopy || q === null) return null;
    const formatted = Formatter.format(q, format, this.settings.precisionFor(format));
    return includeUnit ? formatted.text : formatted.number;
  }

  /** Clipboard text for any value: no ≈, no thousands separators, no unit on decimal values. */
  copyFormat(q: Quantity, formatId: string | null = null): string {
    const format = this.formatOrPrimary(q, formatId);
    return Formatter.format(q, format, this.settings.precisionFor(format)).number;
  }

  /** The format a stored value was shown in, or the main format for its dimension. */
  formatOrPrimary(q: Quantity, formatId: string | null | undefined): DisplayFormat {
    const f = Formats.find(formatId);
    return f && f.power === q.power ? f : this.settings.primaryFor(q.power);
  }

  /** A value in its display format (by default the main one), prefixed with ≈ when that display is rounded. */
  formatPrimary(q: Quantity, formatId: string | null = null): string {
    const format = this.formatOrPrimary(q, formatId);
    const formatted = Formatter.format(q, format, this.settings.precisionFor(format), RoundingMode.Nearest, true);
    return formatted.isExact ? formatted.text : '≈ ' + formatted.text;
  }

  /** "Copy", or "Copy · mm" when the remembered copy format differs from the display. */
  get copyLabel(): string {
    const preset = this.settings.copyPreset;
    const format = preset.formatId === null ? undefined : Formats.byId(preset.formatId);
    if (!format) return 'Copy';
    const name = format.style === FormatStyle.FeetInches ? 'ft-in' : format.style === FormatStyle.FractionalInches ? 'in' : (format.unit?.symbol ?? format.label);
    return `Copy · ${name}`;
  }

  // ---------------- Tape ----------------

  /** Restores the most recent deletion. False when there's nothing to undo. */
  undo(): boolean {
    const undo = this.lastUndo;
    if (!undo) return false;
    this.lastUndo = null;
    undo.restore();
    this.refresh();
    return true;
  }

  deleteTape(id: string): boolean {
    const tape = this.state.tape;
    const index = tape.findIndex((e) => e.id === id);
    if (index < 0) return false;
    const entry = tape[index];
    tape.splice(index, 1);
    this.lastUndo = {
      description: `Deleted ${this.formatPrimary(entry.value, entry.formatId)}`,
      restore: () => tape.splice(index < tape.length ? index : tape.length, 0, entry),
    };
    return true;
  }

  clearTape(): void {
    const tape = this.state.tape;
    if (tape.length === 0) return;
    const all = [...tape];
    tape.length = 0;
    this.lastUndo = {
      description: `Cleared ${all.length} tape entr${all.length === 1 ? 'y' : 'ies'}`,
      restore: () => {
        tape.unshift(...all);
        if (tape.length > AppState.MaxTapeEntries) tape.splice(0, tape.length - AppState.MaxTapeEntries);
      },
    };
  }

  /** Sets or clears (empty text) the note on a tape entry. */
  setNote(id: string, note: string | null | undefined): boolean {
    const index = this.state.tape.findIndex((e) => e.id === id);
    if (index < 0) return false;
    const cleaned = note == null || isBlank(note) ? null : note.trim();
    this.state.tape[index] = { ...this.state.tape[index], note: cleaned };
    return true;
  }

  /**
   * Text that reproduces a tape result exactly when inserted into a calculation: the original input in
   * brackets, or a 12-place value when the input refers to names (ans, mem, @saved) that may have changed.
   */
  static tapeInsertText(entry: TapeEntry): string {
    const text = entry.input.replace(/\s+(to|as)\s+.*$|\s*(->|→).*$/i, '');
    const dependsOnNames = text.includes('@') || /\b(ans|mem)\b/i.test(text);
    if (!dependsOnNames) return `(${text})`;
    const format =
      entry.value.power === 1 ? Formats.Millimeters : entry.value.power === 2 ? Formats.SquareMeters : entry.value.power === 3 ? Formats.CubicMeters : Formats.Number;
    const value = Formatter.format(entry.value, format, 12).text.replaceAll(' ', '').replaceAll('²', '2').replaceAll('³', '3');
    return `(${value})`;
  }

  /** The tape as readable lines, with units and notes ("12' x 14' = 168.00 ft²  // kitchen"). */
  tapeAsText(): string {
    return this.state.tape
      .map((e) => {
        const primary = this.formatOrPrimary(e.value, e.formatId);
        const line = `${e.input} = ${Formatter.format(e.value, primary, this.settings.precisionFor(primary)).text}`;
        return e.note === null ? line : `${line}  // ${e.note}`;
      })
      .join('\n');
  }

  tapeAsCsv(): string {
    const csv = (s: string): string => (/[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
    let out = 'Time,Input,Result,Value,Unit,Note,Exact value (SI),Dimension\r\n';
    for (const e of this.state.tape) {
      const primary = this.formatOrPrimary(e.value, e.formatId);
      const resultText = Formatter.format(e.value, primary, this.settings.precisionFor(primary)).text;
      // A numeric column Excel can sum: decimal inches for feet-inches results, otherwise the display unit.
      const numeric = primary.isFractional ? Formats.DecimalInches : primary;
      const value = Formatter.format(e.value, numeric, primary.isFractional ? 4 : this.settings.precisionFor(primary)).number;
      const unit = e.value.power === 1 ? 'm' : e.value.power === 2 ? 'm²' : e.value.power === 3 ? 'm³' : '';
      out +=
        [
          csv(localTime(e.at)),
          csv(e.input),
          csv(resultText),
          value,
          csv(numeric.unit?.symbol ?? ''),
          csv(e.note ?? ''),
          csv(`${e.value.si} ${unit}`.trim()),
          Quantity.describe(e.value.power),
        ].join(',') + '\r\n';
    }
    return out;
  }

  // ---------------- Saved values ----------------

  /** Null on success, otherwise a short reason. */
  save(name: string, value: Quantity | null = null, source: string | null = null, formatId: string | null = null): string | null {
    name = name.trim().replace(/^@+/, '');
    const problem = AppState.validateName(name);
    if (problem) return problem;
    if (value === null && this.isStale) return this.error ?? 'Fix the calculation first';
    const q = value ?? this.shown;
    if (q === null) return 'Nothing to save yet';
    if (formatId === null && value === null) formatId = this.display?.format.id ?? null;
    const saved: SavedValue = { name, value: q, source: source ?? (this.isTyping ? this._result.calculated.trim() : this.answerInput), formatId };
    this.state.save(saved);
    this.refresh();
    return null;
  }

  deleteSaved(name: string): boolean {
    const list = this.state.savedValues;
    const index = list.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
    if (index < 0) return false;
    const saved = list[index];
    list.splice(index, 1);
    this.lastUndo = {
      description: `Deleted @${saved.name}`,
      restore: () => {
        if (!list.some((v) => v.name.toLowerCase() === saved.name.toLowerCase())) list.splice(index < list.length ? index : list.length, 0, saved);
      },
    };
    this.refresh();
    return true;
  }

  savedName(index: number): string | null {
    return index >= 0 && index < this.state.savedValues.length ? this.state.savedValues[index].name : null;
  }

  // ---------------- Memory ----------------

  /** Null on success, otherwise a short message for the user. */
  memoryAdd(sign: 1 | -1): string | null {
    if (this.isStale) return this.error ?? 'Fix the calculation first';
    const q = this.shown;
    if (q === null) return 'Nothing to add yet';
    let signed = quantity(sign === 1 ? q.si : q.si.neg(), q.power, q.exact);
    const m = this.state.memory;
    if (m) {
      if (m.power !== q.power) return `Memory holds ${Quantity.describe(m.power)}`;
      signed = quantity(m.si.add(signed.si), m.power, m.exact && signed.exact);
    }
    this.state.memory = signed;
    this.refresh();
    return null;
  }

  memoryClear(): void {
    this.state.memory = null;
    this.refresh();
  }
}

/** The unit of the first value typed, or whether that value is "ans". Stops at "to". */
function firstValue(text: string): { unit: Unit | null; ans: boolean } {
  for (const token of Lexer.tokenizePartial(text)) {
    if (token.kind === TokenKind.Convert || token.kind === TokenKind.End) break;
    if (token.kind === TokenKind.Identifier && token.text === 'ans') return { unit: null, ans: true };
    if (token.kind === TokenKind.Unit) return { unit: token.unit ?? null, ans: false };
  }
  return { unit: null, ans: false };
}

/** "yyyy-MM-dd HH:mm:ss" in local time. */
function localTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
