import { CopyPreset, DefaultCopyPreset } from './copyPreset';
import { DisplayFormat, Formats } from './formats';
import { HyphenAfterFeet } from './parser';
import type { Quantity } from './quantity';
import type { UnitSystem } from './units';

export type ThemePreference = 'System' | 'Light' | 'Dark';
export type LayoutMode = 'Full' | 'Compact';

/** A named value the user can reuse as @name. `formatId` is the format it was shown in when saved. */
export interface SavedValue {
  readonly name: string;
  readonly value: Quantity;
  readonly source: string;
  readonly formatId: string | null;
}

/**
 * One confirmed calculation on the tape.
 * `input`: the calculation as calculated, with any assumed units written in.
 * `hyphen`: how 5'-6" was read when this entry was calculated, so its highlighting stays truthful.
 * `formatId`: the format the result was shown in, so the tape keeps showing it that way.
 */
export interface TapeEntry {
  readonly id: string;
  readonly input: string;
  readonly value: Quantity;
  /** ISO 8601 time. */
  readonly at: string;
  readonly note: string | null;
  readonly hyphen: HyphenAfterFeet;
  readonly formatId: string | null;
}

export class Settings {
  theme: ThemePreference = 'System';
  layout: LayoutMode = 'Full';
  /** Primary format id per dimension ("1" = length, "2" = area, "3" = volume). */
  primaryFormats: Record<string, string> = {
    '0': Formats.Number.id,
    '1': Formats.FeetInches.id,
    '2': Formats.SquareFeet.id,
    '3': Formats.CubicYards.id,
  };
  /** Display precision overrides by format id; missing ids use the format's default. */
  precision: Record<string, number> = {};
  copyPreset: CopyPreset = DefaultCopyPreset;
  hyphenAfterFeet: HyphenAfterFeet = HyphenAfterFeet.FeetAndInches;
  /** Show the answer in the first unit typed (1m + 1 shows m). Off: always primaryFormats. */
  answerFollowsInput = true;
  /** Plain numbers in a sum take its unit: 1m + 1 is 1m + 1m. */
  assumeUnits = true;
  /** Format ids the user turned off in the result panel. The primary format always shows. */
  hiddenFormats: string[] = [];
  showKeypad = true;
  /** On touch screens, type with the device keyboard instead of Cubit's keypad. */
  deviceKeyboard = false;

  primaryFor(power: number): DisplayFormat {
    const format = Formats.byId(this.primaryFormats[String(power)]);
    if (format && format.power === power) return format;
    return Formats.forPower(power)[0];
  }

  setPrimary(format: DisplayFormat): void {
    this.primaryFormats[String(format.power)] = format.id;
  }

  /**
   * Fixes the answer to `format` (turning off answerFollowsInput). Picking a length also moves areas and
   * volumes into its unit system (m → m², m³), so a metric session stays metric.
   */
  pickUnit(format: DisplayFormat): void {
    this.answerFollowsInput = false;
    this.setPrimary(format);
    const system = Settings.systemOf(format);
    if (format.power !== 1 || system === null) return;
    for (const power of [2, 3]) if (Settings.systemOf(this.primaryFor(power)) !== system) this.setPrimary(Formats.defaultFor(power, system));
  }

  /** The main format for a dimension in a unit system: your choice if it's in that system, otherwise the usual one. */
  preferredFor(power: number, system: UnitSystem): DisplayFormat {
    const primary = this.primaryFor(power);
    return Settings.systemOf(primary) === system ? primary : Formats.defaultFor(power, system);
  }

  static systemOf(format: DisplayFormat): UnitSystem | null {
    return format.unit?.system ?? null;
  }

  /** The formats to list for a result, in display order: everything not hidden, plus the primary. */
  visibleFormats(power: number): DisplayFormat[] {
    const primary = this.primaryFor(power);
    return Formats.forPower(power).filter((f) => f.id === primary.id || !this.hiddenFormats.includes(f.id));
  }

  setVisible(format: DisplayFormat, visible: boolean): void {
    this.hiddenFormats = this.hiddenFormats.filter((id) => id !== format.id);
    if (!visible) this.hiddenFormats.push(format.id);
  }

  precisionFor = (format: DisplayFormat): number => {
    const value = this.precision[format.id];
    if (value === undefined) return format.defaultPrecision;
    const valid = format.isFractional ? Formats.Denominators.includes(value) : Number.isInteger(value) && value >= 0 && value <= 12;
    return valid ? value : format.defaultPrecision;
  };
}

const NamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const Reserved = new Set(['ans', 'pi', 'sqrt', 'mem', 'to', 'as', 'x']);

/** Everything Cubit persists, in one versioned document. */
export class AppState {
  static readonly CurrentSchema = 1;
  static readonly MaxTapeEntries = 500;

  schema = AppState.CurrentSchema;
  settings = new Settings();
  savedValues: SavedValue[] = [];
  tape: TapeEntry[] = [];
  memory: Quantity | null = null;

  /** Saved values by lower-case name. */
  get savedLookup(): Map<string, Quantity> {
    return new Map(this.savedValues.map((v) => [v.name.toLowerCase(), v.value]));
  }

  /** Null when `name` is usable; otherwise why not. */
  static validateName(name: string): string | null {
    if (name.trim().length === 0) return 'Give the value a name.';
    if (!NamePattern.test(name)) return 'Use letters, numbers and _ only, starting with a letter (max 32).';
    if (Reserved.has(name.toLowerCase())) return `'${name}' is reserved. Pick another name.`;
    return null;
  }

  /** Adds or replaces a saved value (names are case-insensitive). */
  save(value: SavedValue): void {
    const index = this.savedValues.findIndex((v) => v.name.toLowerCase() === value.name.toLowerCase());
    if (index >= 0) this.savedValues[index] = value;
    else this.savedValues.push(value);
  }

  addToTape(entry: TapeEntry): void {
    this.tape.push(entry);
    if (this.tape.length > AppState.MaxTapeEntries) this.tape.splice(0, this.tape.length - AppState.MaxTapeEntries);
  }
}
