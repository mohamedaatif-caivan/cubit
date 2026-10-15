import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ThemePreference } from '../core/appState';
import { DisplayFormat, Formats } from '../core/formats';
import { HyphenAfterFeet } from '../core/parser';
import { allPassed, runSelfCheck, type SelfCheckReport } from '../core/selfCheck';
import { downloadFile } from './Calculator';
import { BackIcon } from './icons';
import { pwa } from './pwa';
import { errorLog, useStore } from './store';

declare const __APP_VERSION__: string;

/** A setting: title and hint, its control, and an optional result line inside the same card row. */
function Row({ title, hint, children, note }: { title: string; hint?: string; children: ComponentChildren; note?: ComponentChildren }) {
  return (
    <div class="set-row">
      <div class="set-text">
        <div class="set-title">{title}</div>
        {hint && <div class="set-hint">{hint}</div>}
      </div>
      <div class="set-control">{children}</div>
      {note && <div class="set-note">{note}</div>}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} class={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span class="knob" />
    </button>
  );
}

function FormatSelect({ power, label }: { power: number; label: string }) {
  const s = useStore();
  return (
    <select
      aria-label={label}
      value={s.settings.primaryFor(power).id}
      onChange={(e) => {
        const f = Formats.byId((e.currentTarget as HTMLSelectElement).value);
        if (f) s.settings.setPrimary(f);
        s.settingsChanged();
      }}
    >
      {Formats.forPower(power).map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

function PlacesSelect({ format, label }: { format: DisplayFormat; label: string }) {
  const s = useStore();
  return (
    <label class="mini-field">
      <span>{label}</span>
      <select
        value={String(s.settings.precisionFor(format))}
        onChange={(e) => {
          s.settings.precision[format.id] = Number((e.currentTarget as HTMLSelectElement).value);
          s.settingsChanged();
        }}
      >
        {Formats.DecimalPlaces.map((p) => (
          <option key={p} value={String(p)}>
            {p === 1 ? '1 place' : `${p} places`}
          </option>
        ))}
      </select>
    </label>
  );
}

function UnitsShown() {
  const s = useStore();
  const groups: [number, string][] = [
    [1, 'Lengths'],
    [2, 'Areas'],
    [3, 'Volumes'],
  ];
  return (
    <div class="units-shown">
      {groups.map(([power, title]) => (
        <fieldset key={power}>
          <legend>{title}</legend>
          {Formats.forPower(power).map((f) => {
            const primary = s.settings.primaryFor(power).id === f.id;
            return (
              <label key={f.id} class="check" title={primary ? 'Your main format always shows' : undefined}>
                <input
                  type="checkbox"
                  disabled={primary}
                  checked={primary || !s.settings.hiddenFormats.includes(f.id)}
                  onChange={(e) => {
                    s.settings.setVisible(f, (e.currentTarget as HTMLInputElement).checked);
                    s.settingsChanged();
                  }}
                />
                {f.label}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function Verify() {
  const [report, setReport] = useState<SelfCheckReport | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (): void => {
    setBusy(true);
    setReport(null);
    setTimeout(() => {
      setReport(runSelfCheck());
      setBusy(false);
    }, 30);
  };
  return (
    <Row
      title="Verify calculations"
      hint="Cubit uses exact fractions and legal unit definitions (1 in = 25.4 mm). Re-test this copy against its hand-checked answers."
      note={
        report && (
          <div class={`banner ${allPassed(report) ? 'ok' : 'bad'}`} role="status">
            <strong>{allPassed(report) ? 'All checks passed' : `${report.failures.length} check(s) failed`}</strong>
            <p>
              {allPassed(report)
                ? `${report.total} hand-checked calculations, roundings and error cases gave the expected answer.`
                : report.failures.slice(0, 5).join('\n')}
            </p>
          </div>
        )
      }
    >
      <button class="btn" onClick={run} disabled={busy}>
        {busy ? 'Checking…' : 'Verify'}
      </button>
    </Row>
  );
}

function AppSection() {
  const [, bump] = useState(0);
  useEffect(() => pwa.subscribe(() => bump((n) => n + 1)), []);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);
  const check = async (): Promise<void> => {
    setChecking(true);
    const found = await pwa.checkForUpdate();
    setChecking(false);
    setChecked(found ? 'A new version is downloading.' : navigator.onLine ? "You're up to date." : "You're offline. Cubit will check when you're back online.");
  };
  return (
    <>
      {pwa.canInstall && (
        <Row title="Install Cubit" hint="Adds Cubit to your home screen or Start menu. It opens in its own window and works offline.">
          <button class="btn accent" onClick={() => void pwa.install()}>
            Install
          </button>
        </Row>
      )}
      <Row
        title="Updates"
        hint={
          pwa.updateReady
            ? 'A new version is ready.'
            : `Version ${__APP_VERSION__}.${pwa.offlineReady ? ' Ready to work offline.' : ''}${checked ? ' ' + checked : ''}`
        }
      >
        {pwa.updateReady ? (
          <button class="btn accent" onClick={() => pwa.applyUpdate()}>
            Restart now
          </button>
        ) : (
          <button class="btn" onClick={check} disabled={checking || !pwa.supported}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
        )}
      </Row>
    </>
  );
}

function DataSection() {
  const s = useStore();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [includeData, setIncludeData] = useState(false);

  const importFile = async (file: File): Promise<void> => {
    const hasData = s.state.tape.length > 0 || s.state.savedValues.length > 0;
    if (hasData && !confirm('Replace your tape, saved values and settings with this file? Download a backup first if you might want them back.')) return;
    const result = s.importState(await file.text());
    if (!result.ok) {
      setMessage({ ok: false, text: `Couldn't import ${file.name}: ${result.message ?? 'not a Cubit data file.'} Nothing was changed.` });
      return;
    }
    const tape = s.state.tape.length;
    const saved = s.state.savedValues.length;
    const summary = `Imported ${tape} tape entr${tape === 1 ? 'y' : 'ies'} and ${saved} saved value${saved === 1 ? '' : 's'}.`;
    setMessage({ ok: true, text: result.message ? `${summary} ${result.message}` : summary });
  };

  const report = (): void => {
    const lines = [
      `Cubit web ${__APP_VERSION__}`,
      `Time: ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
      `Screen: ${screen.width}x${screen.height} @${devicePixelRatio}`,
      `Installed: ${matchMedia('(display-mode: standalone)').matches}`,
      '',
      'Recent errors:',
      errorLog() || '(none)',
    ];
    if (includeData) lines.push('', 'Data:', s.exportState());
    downloadFile(`Cubit problem report ${new Date().toISOString().slice(0, 10)}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
  };

  return (
    <>
      <Row title="Back up your data" hint="Your tape, saved values and settings stay in this browser. Download a copy to keep or move them.">
        <button class="btn" onClick={() => downloadFile(`Cubit data ${new Date().toISOString().slice(0, 10)}.json`, s.exportState(), 'application/json')}>
          Download
        </button>
      </Row>
      <Row
        title="Import data"
        hint="A Cubit backup, or state.json from the desktop app (%AppData%\Cubit). Replaces what's here."
        note={
          message && (
            <div class={`banner ${message.ok ? 'ok' : 'bad'}`} role="status">
              {message.text}
            </div>
          )
        }
      >
        <label class="btn file-btn">
          Choose file…
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              const file = input.files?.[0];
              if (file) void importFile(file);
              input.value = '';
            }}
          />
        </label>
      </Row>
      <Row title="Report a problem" hint="Downloads a report with recent errors, ready to send.">
        <div class="stack-controls">
          <button class="btn" onClick={report}>
            Create report
          </button>
          <label class="check small">
            <input type="checkbox" checked={includeData} onChange={(e) => setIncludeData((e.currentTarget as HTMLInputElement).checked)} />
            Include my tape and saved values
          </label>
        </div>
      </Row>
    </>
  );
}

export function SettingsPage() {
  const s = useStore();
  const st = s.settings;
  const fractionChoices = Formats.Denominators.slice(1);
  return (
    <div class="settings-page">
      <header class="settings-head">
        <button class="icon-btn" aria-label="Back (Esc)" title="Back (Esc)" onClick={() => s.openSettings(false)}>
          <BackIcon />
        </button>
        <h1>Settings</h1>
      </header>
      <div class="settings-body">
        <section>
          <h2>Display</h2>
          <Row title="Appearance" hint="Light, dark, or match your device">
            <select
              aria-label="Appearance"
              value={st.theme}
              onChange={(e) => {
                st.theme = (e.currentTarget as HTMLSelectElement).value as ThemePreference;
                s.settingsChanged();
              }}
            >
              <option value="System">Use device setting</option>
              <option value="Light">Light</option>
              <option value="Dark">Dark</option>
            </select>
          </Row>
          <Row title="Answer unit" hint="Auto: 1m + 1 shows 2 m">
            <select
              aria-label="Answer unit"
              value={st.answerFollowsInput ? 'auto' : 'fixed'}
              onChange={(e) => s.setAnswerFollowsInput((e.currentTarget as HTMLSelectElement).value === 'auto')}
            >
              <option value="auto">Auto (first unit typed)</option>
              <option value="fixed">The formats below</option>
            </select>
          </Row>
          <Row title="Lengths" hint="Main format for length results">
            <FormatSelect power={1} label="Lengths" />
          </Row>
          <Row title="Fractions" hint="Show feet-inches and inches to the nearest">
            <select
              aria-label="Fractions"
              value={String(st.precisionFor(Formats.FeetInches))}
              onChange={(e) => {
                const d = Number((e.currentTarget as HTMLSelectElement).value);
                st.precision[Formats.FeetInches.id] = d;
                st.precision[Formats.Inches.id] = d;
                s.settingsChanged();
              }}
            >
              {fractionChoices.map((d) => (
                <option key={d} value={String(d)}>
                  1/{d}″
                </option>
              ))}
            </select>
          </Row>
          <Row title="Metric decimal places" hint="For metres and millimetres">
            <div class="pair">
              <PlacesSelect format={Formats.Meters} label="m" />
              <PlacesSelect format={Formats.Millimeters} label="mm" />
            </div>
          </Row>
          <Row title="Areas" hint="Main format for area results">
            <FormatSelect power={2} label="Areas" />
          </Row>
          <Row title="Volumes" hint="Main format for volume results">
            <FormatSelect power={3} label="Volumes" />
          </Row>
          <Row title={'A hyphen after feet, as in 5\'-6"'} hint="Coloured operators always show how it was read">
            <select
              aria-label="A hyphen after feet"
              value={st.hyphenAfterFeet}
              onChange={(e) => {
                st.hyphenAfterFeet = (e.currentTarget as HTMLSelectElement).value as HyphenAfterFeet;
                s.settingsChanged();
              }}
            >
              <option value={HyphenAfterFeet.FeetAndInches}>Feet-inches (5 ft 6 in)</option>
              <option value={HyphenAfterFeet.Minus}>Minus (5 ft − 6 in)</option>
            </select>
          </Row>
          <Row title="Numbers without a unit" hint="1m + 1 reads as 1m + 1m">
            <Switch
              label="Numbers without a unit"
              checked={st.assumeUnits}
              onChange={(v) => {
                st.assumeUnits = v;
                s.settingsChanged();
              }}
            />
          </Row>
          <div class="set-row column">
            <div class="set-text">
              <div class="set-title">Units shown</div>
              <div class="set-hint">Choose which units appear under the result. Your main formats always show.</div>
            </div>
            <UnitsShown />
          </div>
        </section>

        <section>
          <h2>Keypad and keyboard</h2>
          <Row title="Keypad" hint="Show the keypad in the full layout">
            <Switch
              label="Keypad"
              checked={st.showKeypad}
              onChange={(v) => {
                st.showKeypad = v;
                s.settingsChanged();
              }}
            />
          </Row>
          <Row title="Device keyboard" hint="On touch screens, type with your phone's keyboard instead of only the keypad">
            <Switch
              label="Device keyboard"
              checked={st.deviceKeyboard}
              onChange={(v) => {
                st.deviceKeyboard = v;
                s.settingsChanged();
              }}
            />
          </Row>
        </section>

        <section>
          <h2>Accuracy</h2>
          <Verify />
        </section>

        <section>
          <h2>App</h2>
          <AppSection />
        </section>

        <section>
          <h2>Your data</h2>
          <DataSection />
        </section>
      </div>
    </div>
  );
}
