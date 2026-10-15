import { Component, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Display, Keypad, SavedChips, SidePanel, Tiles, downloadFile, openCopyOptions, openSave } from './Calculator';
import { activeInput, isTouch } from './ExpressionInput';
import { Help } from './Help';
import { CloseIcon, CompactIcon, ExpandIcon, ExportIcon, HelpIcon, SettingsIcon, TapeIcon } from './icons';
import { Anchor, anchorOf } from './Popover';
import { pwa } from './pwa';
import { SettingsPage } from './Settings';
import { errorLog, logError, store, useStore } from './store';

declare const __APP_VERSION__: string;

// ---------------- Keyboard ----------------

let helpOpener: ((anchor: Anchor | null) => void) | null = null;

const isField = (el: Element | null): boolean =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

/** Shortcuts that work anywhere on the page, as in the desktop app. */
function handleKeys(e: KeyboardEvent): void {
  if (e.defaultPrevented) return; // the calculation box or a popover already handled it
  const ctrl = e.ctrlKey || e.metaKey;
  const target = e.target as HTMLElement | null;
  const inCalc = !!target?.classList?.contains('expr-input');
  const inOtherField = !inCalc && isField(target);
  const inPopover = !!target?.closest?.('.popover-layer');

  // Ctrl+1…9 can be taken by the browser for switching tabs, so Alt+1…9 does the same.
  const digit = /^(Digit|Numpad)[1-9]$/.test(e.code) && !e.shiftKey && (ctrl !== e.altKey) ? Number(e.code.slice(-1)) : 0;
  if (digit && !inOtherField) {
    const name = store.session.savedName(digit - 1);
    if (name) activeInput()?.insert('@' + name);
    e.preventDefault();
    return;
  }

  if (ctrl && !e.altKey) {
    const key = e.key.toLowerCase();
    if (inOtherField || inPopover) {
      if (key === 's') e.preventDefault(); // never the browser's "Save page"
      return; // a note or a name being typed: leave its keys alone
    }
    if (key === 'z' && !e.shiftKey && store.undoNotice) {
      store.undo(); // brings back the deleted tape entry or saved value
    } else if (key === 'c' && e.shiftKey) {
      openCopyOptions();
    } else if (key === 'c') {
      // Selected text copies normally; otherwise Ctrl+C copies the result.
      if (activeInput()?.hasSelection() || (document.getSelection()?.toString().length ?? 0) > 0) return;
      store.copyCurrent();
    } else if (key === 's') openSave();
    else if (key === 'm') store.toggleLayout();
    else if (key === 'u') store.toggleAuto();
    else if (key === 'l') activeInput()?.selectAll();
    else if (key === ',') store.openSettings(!store.settingsOpen);
    else return;
    e.preventDefault();
    return;
  }
  if (ctrl || e.altKey || inPopover) return;
  if (e.key === 'F1') {
    helpOpener?.(null);
    e.preventDefault();
  } else if (e.key === 'Escape' && store.settingsOpen) {
    store.openSettings(false);
    e.preventDefault();
  } else if (e.key === 'Escape' && store.sideOpen) {
    store.setSideOpen(false);
    e.preventDefault();
  } else if (!inCalc && !inOtherField && !store.settingsOpen && (target === document.body || target?.closest?.('.keypad, .tiles'))) {
    // Nothing focused: keys go to the calculation, as if it had focus.
    const input = activeInput();
    if (!input) return;
    if (e.key.length === 1) input.focus();
    else if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      input.focus();
      e.preventDefault();
      if (e.key === 'Enter') store.commit();
      else if (e.key === 'Backspace') input.backspace();
      else if (e.key === 'Escape') store.clear();
      else {
        const text = store.recall(e.key === 'ArrowUp' ? 1 : -1);
        if (text !== null) store.setInput(text);
      }
    }
  }
}

/**
 * After a mouse click on a button (Copy, a tab, Export, a tile…) the calculation box takes the keyboard
 * back, so typing, Enter and Esc keep working. Keyboard users who tabbed to a button keep their place.
 */
function refocusAfterClick(e: MouseEvent): void {
  if (e.detail === 0 || store.settingsOpen) return;
  const target = e.target as HTMLElement | null;
  if (!target?.closest || target.closest('.popover-layer, .settings-page, .save-box')) return;
  if (!target.closest('button, [role="tab"]')) return;
  if (isTouch() && store.settings.deviceKeyboard) return; // don't pop up the phone keyboard
  setTimeout(() => {
    if (document.querySelector('.popover-layer')) return; // the click opened a menu or form: it has the keyboard
    const active = document.activeElement;
    if (!active || active === document.body || active.tagName === 'BUTTON') activeInput()?.focus();
  }, 0);
}

// ---------------- Theme ----------------

function applyTheme(): void {
  const theme = store.settings.theme;
  const root = document.documentElement;
  if (theme === 'System') delete root.dataset.theme;
  else root.dataset.theme = theme.toLowerCase();
  const dark = theme === 'Dark' || (theme === 'System' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', dark ? '#0f1a2e' : '#f2f5f9');
}

// ---------------- Header ----------------

function Logo() {
  return (
    <div class="brand">
      <img src="./icon.svg" width="22" height="22" alt="" />
      <span>Cubit</span>
    </div>
  );
}

function HeaderButton(props: { label: string; onClick: (e: MouseEvent) => void; children: ComponentChildren; expanded?: boolean; help?: boolean }) {
  return (
    <button
      class="icon-btn"
      aria-label={props.label}
      title={props.label}
      aria-expanded={props.expanded}
      data-help={props.help ? '' : undefined}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function Header({ compact, narrow, onHelp }: { compact: boolean; narrow: boolean; onHelp: (anchor: Anchor) => void }) {
  const s = useStore();
  const [, bump] = useState(0);
  useEffect(() => pwa.subscribe(() => bump((n) => n + 1)), []);
  return (
    <header class="bar">
      <Logo />
      <div class="bar-actions">
        {pwa.canInstall && (
          <button class="btn install" title="Install Cubit as an app on this device" onClick={() => void pwa.install()}>
            <ExportIcon /> Install
          </button>
        )}
        {!compact && (
          <HeaderButton label="How to type measurements (F1)" help onClick={(e) => onHelp(anchorOf(e))}>
            <HelpIcon />
          </HeaderButton>
        )}
        {!compact && narrow && (
          <HeaderButton label="Tape and saved values" expanded={s.sideOpen} onClick={() => s.setSideOpen(!s.sideOpen)}>
            <TapeIcon />
          </HeaderButton>
        )}
        <HeaderButton label={compact ? 'Full layout (Ctrl+M)' : 'Compact layout (Ctrl+M)'} onClick={() => s.toggleLayout()}>
          {compact ? <ExpandIcon /> : <CompactIcon />}
        </HeaderButton>
        <HeaderButton label="Settings (Ctrl+,)" onClick={() => s.openSettings(true)}>
          <SettingsIcon />
        </HeaderButton>
      </div>
    </header>
  );
}

// ---------------- Layouts ----------------

function useWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

function FullView({ onHelp }: { onHelp: (anchor: Anchor) => void }) {
  const s = useStore();
  const width = useWidth();
  // The desktop app docks the tape from 820 px.
  const docked = width >= 820;
  useEffect(() => {
    if (docked && s.sideOpen) s.setSideOpen(false);
  }, [docked]);
  return (
    <div class="app full">
      <Header compact={false} narrow={!docked} onHelp={onHelp} />
      <main class={`full-main ${docked ? 'docked' : ''}`}>
        <div class="calc">
          <Display />
          <Tiles />
          {s.settings.showKeypad && <Keypad />}
        </div>
        {docked && (
          <aside class="side" aria-label="Tape and saved values">
            <SidePanel />
          </aside>
        )}
      </main>
      {!docked && s.sideOpen && (
        <div class="drawer-layer">
          <div class="drawer-backdrop" onClick={() => s.setSideOpen(false)} />
          <aside class="drawer" aria-label="Tape and saved values">
            <button class="icon-btn drawer-close" aria-label="Close tape and saved values" onClick={() => s.setSideOpen(false)}>
              <CloseIcon />
            </button>
            <SidePanel />
          </aside>
        </div>
      )}
    </div>
  );
}

function CompactView({ onHelp }: { onHelp: (anchor: Anchor) => void }) {
  return (
    <div class="app compact">
      <Header compact narrow onHelp={onHelp} />
      <main class="compact-main">
        <Display compact />
        <Tiles compact />
        <SavedChips />
      </main>
    </div>
  );
}

// ---------------- Banners and notices ----------------

const IosHintKey = 'cubit.iosHintDismissed';

/** iPhones can't be offered an Install button, so they get the steps instead. */
function needsIosHint(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(IosHintKey) === '1';
  } catch {
    dismissed = false;
  }
  return ios && !standalone && !dismissed;
}

function Notices() {
  const s = useStore();
  const [warning, setWarning] = useState(s.startupWarning);
  const [iosHint, setIosHint] = useState(needsIosHint);
  const [, bump] = useState(0);
  useEffect(() => pwa.subscribe(() => bump((n) => n + 1)), []);
  return (
    <>
      {warning && (
        <div class="banner warn top" role="alert">
          <span>
            <strong>Saved data</strong> {warning}
          </span>
          <button class="icon-btn" aria-label="Dismiss" onClick={() => setWarning(null)}>
            <CloseIcon />
          </button>
        </div>
      )}
      {pwa.updateReady && (
        <div class="banner info top" role="status">
          <span>Update ready. Restart to use the new version.</span>
          <button class="btn accent" onClick={() => pwa.applyUpdate()}>
            Restart now
          </button>
        </div>
      )}
      {iosHint && !warning && !pwa.updateReady && (
        <div class="banner info top" role="status">
          <span>
            <strong>Install Cubit</strong> to keep your tape and work offline: in Safari, tap Share, then Add to Home Screen.
          </span>
          <button
            class="icon-btn"
            aria-label="Dismiss"
            onClick={() => {
              try {
                localStorage.setItem(IosHintKey, '1');
              } catch {
                // Private browsing: the hint simply comes back next time.
              }
              setIosHint(false);
            }}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <div class="notice-host" aria-live="polite">
        {s.undoNotice && (
          <div class="notice" key={s.undoNotice.id}>
            <span>{s.undoNotice.text}</span>
            <button
              class="link"
              title="Undo (Ctrl+Z)"
              onClick={() => {
                s.undo();
                activeInput()?.focus();
              }}
            >
              Undo
            </button>
          </div>
        )}
        {s.toastNotice && (
          <div class="notice" key={s.toastNotice.id}>
            <span>{s.toastNotice.text}</span>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------- App ----------------

/** A render error shows a way out instead of a blank page. */
class ErrorBoundary extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false };

  override componentDidCatch(error: unknown): void {
    logError(`Render: ${error instanceof Error ? `${error.message} ${error.stack ?? ''}` : String(error)}`);
    this.setState({ failed: true });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div class="crash">
        <h1>Something went wrong</h1>
        <p>Cubit hit an error. Your tape and saved values are kept. Reload to carry on, or download a report to send.</p>
        <div class="form-actions">
          <button
            class="btn"
            onClick={() =>
              downloadFile(
                'Cubit problem report.txt',
                [`Cubit web ${__APP_VERSION__}`, `Browser: ${navigator.userAgent}`, '', errorLog()].join('\n'),
                'text/plain;charset=utf-8',
              )
            }
          >
            Download report
          </button>
          <button class="btn accent" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  const s = useStore();
  const [help, setHelp] = useState<Anchor | null>(null);
  helpOpener = (anchor) => {
    const el = document.querySelector('[data-help]') ?? document.querySelector('.expr');
    setHelp(anchor ?? (el ? { el } : { x: 16, y: 56 }));
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeys);
    document.addEventListener('click', refocusAfterClick);
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    const onHide = (): void => store.saveNow();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('keydown', handleKeys);
      document.removeEventListener('click', refocusAfterClick);
      media.removeEventListener('change', applyTheme);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);
  useEffect(applyTheme);

  // Settings returning to the calculator hands the keyboard back to it.
  useEffect(() => {
    if (!s.settingsOpen && !(isTouch() && s.settings.deviceKeyboard)) setTimeout(() => activeInput()?.focus(), 0);
  }, [s.settingsOpen]);

  return (
    <ErrorBoundary>
      {s.settingsOpen ? (
        <SettingsPage />
      ) : s.settings.layout === 'Compact' ? (
        <CompactView onHelp={setHelp} />
      ) : (
        <FullView onHelp={setHelp} />
      )}
      {help && <Help anchor={help} onClose={() => setHelp(null)} />}
      <Notices />
    </ErrorBoundary>
  );
}
