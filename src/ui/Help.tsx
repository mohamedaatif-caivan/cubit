import { Anchor, Popover } from './Popover';

const typing: [string, string][] = [
  ['5\'6 1/2"', 'Feet and inches. Also 5\'-6 1/2" or 5 ft 6.5 in'],
  ['6-1/2"', 'Inches with a fraction (or 6 1/2")'],
  ['1.2m + 300mm', 'Mix any units: mm cm m km in ft yd mi'],
  ['1m + 1', "A number without a unit takes the sum's unit"],
  ['5\' - 6"', 'Subtract. Coloured operators show how it was read'],
  ["12' x 14'", 'Area. Length × width × depth gives volume'],
  ['16 yd3 + 10%', 'Add waste or a discount'],
  ['… to mm', 'Show in a unit: to m2, to ft-in, to yd3'],
  ["sqrt(9'^2 + 12'^2)", 'Diagonal. Also ², ³ and π'],
  ['@wall  ans  mem', 'A saved value, the last answer, memory'],
];

const keyboard: [string[][], string][] = [
  [[['Enter']], 'Add to the tape'],
  [[['Esc']], 'Clear'],
  [[['↑'], ['↓']], 'Earlier calculations'],
  [[['Ctrl', 'C']], 'Copy the result'],
  [[['Ctrl', 'Shift', 'C']], 'Copy options'],
  [[['Ctrl', 'U']], 'Answer in the first unit typed, or fixed'],
  [[['Ctrl', 'S']], 'Save as a named value'],
  [[['Ctrl', '1…9']], 'Insert a saved value'],
  [[['Alt', 'F'], ['Alt', 'I']], 'Type \' or "'],
  [[['Ctrl', 'M']], 'Full or compact layout'],
  [[['Ctrl', ',']], 'Settings'],
];

/** Typing examples and a keyboard table (F1). */
export function Help({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} class="help" label="Typing help">
      <h2 class="pop-title">Typing measurements</h2>
      <dl class="help-grid">
        {typing.map(([example, meaning]) => (
          <>
            <dt>
              <code>{example}</code>
            </dt>
            <dd>{meaning}</dd>
          </>
        ))}
      </dl>
      <h2 class="pop-title">Keyboard</h2>
      <dl class="help-grid keys">
        {keyboard.map(([combos, action]) => (
          <>
            <dt>
              {combos.map((combo, c) => (
                <>
                  {c > 0 && <span class="muted"> / </span>}
                  {combo.map((key, k) => (
                    <>
                      {k > 0 && <span class="muted">+</span>}
                      <kbd>{key}</kbd>
                    </>
                  ))}
                </>
              ))}
            </dt>
            <dd>{action}</dd>
          </>
        ))}
      </dl>
    </Popover>
  );
}
