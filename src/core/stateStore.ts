import { Rational } from './rational';
import { AppState, LayoutMode, SavedValue, Settings, TapeEntry, ThemePreference } from './appState';
import { CopyPreset, CopyRounding, DefaultCopyPreset } from './copyPreset';
import { HyphenAfterFeet } from './parser';
import { Quantity, quantity } from './quantity';

/*
 * Saved data uses the same JSON shape as the desktop app's state.json (camelCase, string enums, exact
 * values as "n/d" text, never JSON floats), so a desktop file can be imported and vice versa.
 */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;

/** Thrown when saved data can't be read at all. */
export class StateFormatError extends Error {}

function readQuantity(v: unknown): Quantity {
  if (!isObject(v)) throw new StateFormatError('Invalid value.');
  const si = typeof v.si === 'string' ? Rational.tryParse(v.si) : null;
  const power = int(v.power, -1);
  if (si === null || power < 0 || power > 3) throw new StateFormatError('Invalid exact number.');
  return quantity(si, power, bool(v.exact, true));
}

const writeQuantity = (q: Quantity): Json => ({ si: q.si.toString(), power: q.power, exact: q.exact });

function readCopyPreset(v: unknown): CopyPreset {
  if (!isObject(v)) return DefaultCopyPreset;
  return {
    formatId: strOrNull(v.formatId),
    rounding: oneOf(v.rounding, Object.values(CopyRounding), CopyRounding.AsShown),
    precision: int(v.precision, DefaultCopyPreset.precision),
    includeUnit: bool(v.includeUnit, false),
    increment: strOrNull(v.increment),
  };
}

function readSettings(v: unknown): Settings {
  const s = new Settings();
  if (!isObject(v)) return s;
  s.theme = oneOf<ThemePreference>(v.theme, ['System', 'Light', 'Dark'], s.theme);
  s.layout = oneOf<LayoutMode>(v.layout, ['Full', 'Compact'], s.layout);
  if (isObject(v.primaryFormats))
    for (const [k, id] of Object.entries(v.primaryFormats)) if (typeof id === 'string') s.primaryFormats[k] = id;
  if (isObject(v.precision)) for (const [k, p] of Object.entries(v.precision)) if (typeof p === 'number' && Number.isInteger(p)) s.precision[k] = p;
  s.copyPreset = readCopyPreset(v.copyPreset);
  s.hyphenAfterFeet = oneOf(v.hyphenAfterFeet, Object.values(HyphenAfterFeet), s.hyphenAfterFeet);
  s.answerFollowsInput = bool(v.answerFollowsInput, s.answerFollowsInput);
  s.assumeUnits = bool(v.assumeUnits, s.assumeUnits);
  if (Array.isArray(v.hiddenFormats)) s.hiddenFormats = v.hiddenFormats.filter((x): x is string => typeof x === 'string');
  s.showKeypad = bool(v.showKeypad, s.showKeypad);
  s.deviceKeyboard = bool(v.deviceKeyboard, s.deviceKeyboard);
  return s;
}

function readTapeEntry(v: unknown): TapeEntry {
  if (!isObject(v)) throw new StateFormatError('Invalid tape entry.');
  return {
    id: str(v.id, crypto.randomUUID()),
    input: str(v.input, ''),
    value: readQuantity(v.value),
    at: str(v.at, new Date().toISOString()),
    note: strOrNull(v.note),
    hyphen: oneOf(v.hyphen, Object.values(HyphenAfterFeet), HyphenAfterFeet.FeetAndInches),
    formatId: strOrNull(v.formatId),
  };
}

function readSaved(v: unknown): SavedValue {
  if (!isObject(v) || typeof v.name !== 'string') throw new StateFormatError('Invalid saved value.');
  return { name: v.name, value: readQuantity(v.value), source: str(v.source, ''), formatId: strOrNull(v.formatId) };
}

export const StateStore = {
  toJson(state: AppState): string {
    const s = state.settings;
    return JSON.stringify(
      {
        schema: AppState.CurrentSchema,
        settings: {
          theme: s.theme,
          layout: s.layout,
          primaryFormats: s.primaryFormats,
          precision: s.precision,
          copyPreset: s.copyPreset,
          hyphenAfterFeet: s.hyphenAfterFeet,
          answerFollowsInput: s.answerFollowsInput,
          assumeUnits: s.assumeUnits,
          hiddenFormats: s.hiddenFormats,
          showKeypad: s.showKeypad,
          deviceKeyboard: s.deviceKeyboard,
        },
        savedValues: state.savedValues.map((v) => ({ ...v, value: writeQuantity(v.value) })),
        tape: state.tape.map((e) => ({ ...e, value: writeQuantity(e.value) })),
        memory: state.memory ? writeQuantity(state.memory) : null,
      },
      null,
      2,
    );
  },

  /** The state, plus a message for the user when part of it couldn't be used. Throws StateFormatError when unreadable. */
  fromJson(text: string): { state: AppState; warning: string | null } {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new StateFormatError('Not a Cubit data file.');
    }
    if (!isObject(raw)) throw new StateFormatError('Not a Cubit data file.');
    const state = new AppState();
    state.settings = readSettings(raw.settings);
    let skipped = 0;
    const each = <T>(list: unknown, read: (v: unknown) => T): T[] => {
      if (!Array.isArray(list)) return [];
      const out: T[] = [];
      for (const item of list) {
        try {
          out.push(read(item));
        } catch (e) {
          if (!(e instanceof StateFormatError)) throw e;
          skipped++;
        }
      }
      return out;
    };
    state.tape = each(raw.tape, readTapeEntry).slice(-AppState.MaxTapeEntries);
    state.savedValues = each(raw.savedValues, readSaved);
    try {
      state.memory = raw.memory == null ? null : readQuantity(raw.memory);
    } catch {
      skipped++;
    }
    const schema = int(raw.schema, AppState.CurrentSchema);
    const warning =
      schema > AppState.CurrentSchema
        ? 'Your settings were saved by a newer version of Cubit. Some options may be reset.'
        : skipped > 0
          ? `${skipped} saved item${skipped === 1 ? '' : 's'} couldn't be read and ${skipped === 1 ? 'was' : 'were'} left out.`
          : null;
    return { state, warning };
  },
};
