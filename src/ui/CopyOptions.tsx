import { useState } from 'preact/hooks';
import { CopyPreset, CopyPresets, CopyRounding, DefaultCopyPreset } from '../core/copyPreset';
import { DisplayFormat, Formats } from '../core/formats';
import { CalculatorSession } from '../core/session';
import { Anchor, Popover } from './Popover';
import { useStore } from './store';

const CustomChoice = -1;

const roundings: [string, CopyRounding][] = [
  ['As shown', CopyRounding.AsShown],
  ['Nearest', CopyRounding.Nearest],
  ['Round up', CopyRounding.Up],
  ['Round down', CopyRounding.Down],
];

/**
 * Copy options: format, rounding and increment, with a live preview of exactly what will be copied.
 * Whatever you copy from here becomes the default for the one-click Copy button.
 */
export function CopyOptions({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
  const s = useStore();
  const settings = s.settings;
  const initial = settings.copyPreset;
  const shownFormat = s.session.display?.format ?? null;
  const power = s.session.shown?.power ?? 1;
  const formats = settings.visibleFormats(power);

  const [formatId, setFormatId] = useState<string | null>(formats.some((f) => f.id === initial.formatId) ? initial.formatId : null);
  const [rounding, setRounding] = useState(initial.rounding);
  const [includeUnit, setIncludeUnit] = useState(initial.includeUnit);
  const [step, setStep] = useState(initial.increment ?? '');
  const effective: DisplayFormat = Formats.byId(formatId) ?? shownFormat ?? Formats.FeetInches;

  const choicesFor = (format: DisplayFormat): [string, number][] => [
    ...(format.isFractional ? Formats.Denominators : Formats.DecimalPlaces)
      .slice()
      .reverse()
      .map((p): [string, number] => [CalculatorSession.incrementText(format, p), p]),
    ['Custom…', CustomChoice],
  ];
  const pickPrecision = (format: DisplayFormat, preferred: number): number => {
    const values = choicesFor(format).map(([, v]) => v);
    return values.includes(preferred) ? preferred : settings.precisionFor(format);
  };
  const [precision, setPrecision] = useState(
    CopyPresets.customIncrement(initial) ? CustomChoice : pickPrecision(effective, initial.precision),
  );

  const isCustom = precision === CustomChoice;
  const preset: CopyPreset = isCustom
    ? CopyPresets.make(formatId, rounding, settings.precisionFor(effective), includeUnit, step.trim())
    : CopyPresets.make(formatId, rounding, precision, includeUnit);
  const preview = s.copyText(preset) ?? '—';
  const stepValid = CopyPresets.tryParseIncrement(step) !== null;
  const unitName = effective.isFractional ? 'in' : (effective.unit?.symbol ?? '');

  const copy = async (): Promise<void> => {
    if (await s.copy(s.copyText(preset))) {
      s.rememberCopyPreset(preset);
      onClose();
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} class="copy-options" label="Copy options">
      <h2 class="pop-title">Copy options</h2>
      <label class="field">
        <span>Format</span>
        <select
          value={formatId ?? ''}
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value || null;
            setFormatId(id);
            const format = Formats.byId(id) ?? shownFormat ?? Formats.FeetInches;
            if (!isCustom) setPrecision(pickPrecision(format, settings.copyPreset.precision));
          }}
        >
          <option value="">Same as display{shownFormat ? ` (${shownFormat.label})` : ''}</option>
          {formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div class="field-row">
        <label class="field">
          <span>Rounding</span>
          <select value={rounding} onChange={(e) => setRounding((e.currentTarget as HTMLSelectElement).value as CopyRounding)}>
            {roundings.map(([label, value]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>To the nearest</span>
          <select
            value={String(precision)}
            disabled={rounding === CopyRounding.AsShown}
            onChange={(e) => setPrecision(Number((e.currentTarget as HTMLSelectElement).value))}
          >
            {choicesFor(effective).map(([label, value]) => (
              <option key={value} value={String(value)}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isCustom && rounding !== CopyRounding.AsShown && (
        <label class="field">
          <span>Round to the nearest … {unitName}</span>
          <input type="text" inputMode="decimal" value={step} placeholder="e.g. 0.25" onInput={(e) => setStep((e.currentTarget as HTMLInputElement).value)} />
          <small class={step.length === 0 || stepValid ? 'hint' : 'hint bad'}>
            {step.length === 0 || stepValid ? 'Any step: 0.25, 5, 1/8, 1 1/2' : 'Use a number like 0.25 or 1/8'}
          </small>
        </label>
      )}
      {!effective.isFractional && (
        <label class="check">
          <input type="checkbox" checked={includeUnit} onChange={(e) => setIncludeUnit((e.currentTarget as HTMLInputElement).checked)} />
          Include unit ({effective.unit?.symbol})
        </label>
      )}
      <div class="preview">
        <small>Will copy</small>
        <output>{preview}</output>
      </div>
      <button class="btn accent wide" onClick={copy}>
        Copy
      </button>
      <button
        class="link"
        onClick={() => {
          s.rememberCopyPreset(DefaultCopyPreset);
          onClose();
        }}
      >
        Reset to default
      </button>
    </Popover>
  );
}
