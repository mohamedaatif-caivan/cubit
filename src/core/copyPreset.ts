import { Rational, RoundingMode } from './rational';
import { DisplayFormat, Formats } from './formats';
import { FormattedValue, Formatter } from './formatter';
import type { Quantity } from './quantity';

export enum CopyRounding {
  /** Exactly what the result panel shows (display precision, nearest). */
  AsShown = 'AsShown',
  Nearest = 'Nearest',
  Up = 'Up',
  Down = 'Down',
}

/**
 * How the copy button formats a result. Copying never changes the result itself.
 * `formatId`: a DisplayFormat id, or null to copy in the primary display format.
 * `precision`: denominator or decimal places; ignored for AsShown.
 * `includeUnit`: append the unit symbol to decimal values ("1676.4 mm"). Off by default so values paste
 * into Excel and CAD as numbers; feet-inches always keep their ' and " marks.
 * `increment`: optional custom step in the format's unit, as exact text ("0.25" yd³, "5" mm, "1/8" in).
 * When set and valid it replaces `precision`.
 */
export interface CopyPreset {
  readonly formatId: string | null;
  readonly rounding: CopyRounding;
  readonly precision: number;
  readonly includeUnit: boolean;
  readonly increment: string | null;
}

export const DefaultCopyPreset: CopyPreset = {
  formatId: null,
  rounding: CopyRounding.AsShown,
  precision: 16,
  includeUnit: false,
  increment: null,
};

export const CopyPresets = {
  make(formatId: string | null, rounding: CopyRounding, precision: number, includeUnit = false, increment: string | null = null): CopyPreset {
    return { formatId, rounding, precision, includeUnit, increment };
  },

  /** Accepts 0.25, 5, 1/8 or 1 1/2; rejects zero, negatives and anything else. */
  tryParseIncrement(text: string | null | undefined): Rational | null {
    if (text == null || text.trim().length === 0) return null;
    const parts = text.trim().split(' ').filter((p) => p.length > 0);
    let total = Rational.Zero;
    for (const part of parts) {
      const piece = Rational.tryParse(part);
      if (piece === null || piece.sign < 0) return null;
      total = total.add(piece);
    }
    if (parts.length > 2 || total.sign <= 0) return null;
    return total;
  },

  /** The custom step, if `increment` is a positive exact number. */
  customIncrement(preset: CopyPreset): Rational | null {
    return CopyPresets.tryParseIncrement(preset.increment);
  },

  /** The text to put on the clipboard. */
  format(preset: CopyPreset, value: Quantity, primary: DisplayFormat, displayPrecision: (f: DisplayFormat) => number): string {
    let format = preset.formatId === null ? primary : (Formats.byId(preset.formatId) ?? primary);
    const pick = (f: FormattedValue): string => (preset.includeUnit ? f.text : f.number);
    // A preset made for another dimension (a length preset on an area) copies the result as shown.
    if (format.power !== value.power || preset.rounding === CopyRounding.AsShown) {
      if (format.power !== value.power) format = primary;
      return pick(Formatter.format(value, format, displayPrecision(format)));
    }
    const mode = preset.rounding === CopyRounding.Up ? RoundingMode.Up : preset.rounding === CopyRounding.Down ? RoundingMode.Down : RoundingMode.Nearest;
    const custom = CopyPresets.customIncrement(preset);
    if (custom) return pick(Formatter.formatStep(value, format, custom, mode));
    const valid = format.isFractional
      ? Formats.Denominators.includes(preset.precision)
      : preset.precision >= 0 && preset.precision <= 12 && Number.isInteger(preset.precision);
    return pick(Formatter.format(value, format, valid ? preset.precision : displayPrecision(format), mode));
  },
};
