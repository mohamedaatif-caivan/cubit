import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { CopyButton, Display, Keypad, SavedChips, SidePanel, Tiles, openCopyOptions, openSave } from './Calculator';
import { activeInput } from './ExpressionInput';
import { Help } from './Help';
import { CloseIcon, CompactIcon, ExpandIcon, HelpIcon, PopOutIcon, SettingsIcon, TapeIcon } from './icons';
import { Anchor, anchorOf } from './Popover';
import { pwa } from './pwa';
import { SettingsPage } from './Settings';
import { store, useStore } from './store';

void CopyButton;

// ---------------- Keyboard ----------------

let helpOpener: ((anchor: Anchor | null) => void) | null = null;

/** Shortcuts that work anywhere on the page, as in the desktop app. */
export function handleKeys(e: KeyboardEvent, doc: Document): void {
  const ctrl = e.ctrlKey || e.metaKey;
  const target = e.target as HTMLElement | null;
  const inCalc = !!target?.classList?.contains('expr-input');
  const inOtherField = !inCalc && !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

  if (ctrl && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key === 'c' && e.shiftKey) {
      openCopyOptions(doc);
    } else if (key === 'c') {
      // Selected text copies normally; otherwise Ctrl+C copies the result.
      if (inOtherField || activeInput()?.hasSelection() || (doc.getSelection()?.toString().length ?? 0) > 0) return;
      store.copyCurrent();
    } else if (key === 's') openSave(doc);
    else if (key === 'm') store.toggleLayout();
    else if (key === 'u') store.toggleAuto();
    else if (key === 'l') activeInput()?.selectAll();
    else if (key === ',') store.openSettings(!store.settingsOpen);
    else if (/^(Digit|Numpad)[1-9]$/.test(e.code)) {
      const name = store.session.savedName(Number(e.code.slice(-1)) - 1);
      if (name) activeInput()?.insert('@' + name);
    } else return;
    e.preventDefault();
    return;
  }
  if (ctrl || e.altKey) return;
  if (e.key === 'F1') {
    helpOpener?.(null);
    e.preventDefault();
  } else if (e.key === 'Escape' && store.settingsOpen) {
    store.openSettings(false);
    e.preventDefault();
    setTimeout(() => activeInput()?.focus(), 0);
  } else if (e.key === 'Escape' && store.sideOpen) {
    store.setSideOpen(false);
    e.preventDefault();
  } else if (!inCalc && !inOtherField && !store.settingsOpen && e.key.length === 1 && (target === doc.body || target?.closest?.('.keypad, .tiles'))) {
    // Typing anywhere goes to the calculation.
    activeInput()?.focus();
  }
}

// ---------------- Theme ----------------

function applyTheme(doc: Document): void {
  const theme = store.settings.theme;
  const root = doc.documentElement;
  if (theme === 'System') delete root.dataset.theme;
  else root.dataset.theme = theme.toLowerCase();
  const dark = theme === 'Dark' || (theme === 'System' && matchMedia('(prefers-color-scheme: dark)').matches);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1a2e' : '#f2f5f9');
}

// ---------------- Keep on top (Document Picture-in-Picture) ----------------

interface PipApi {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
  window: Window | null;
}
const pipApi = (): PipApi | undefined => (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
export const canPopOut = (): boolean => pipApi() !== undefined;

/** Opens the compact calculator in a small window that stays above other apps (Chrome and Edge). */
async function popOut(): Promise<void> {
  const api = pipApi();
  if (!api) return;
  if (api.window) {
    api.window.focus();
    return;
  }
  let pip: Window;
  try {
    pip = await api.requestWindow({ width: 420, height: 260 });
  } catch {
    store.toast("This browser couldn't open a floating window");
    return;
  }
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) pip.document.head.appendChild(node.cloneNode(true));
  pip.document.title = 'Cubit';
  pip.document.body.classList.add('pip');
  const host = pip.document.createElement('div');
  pip.document.body.appendChild(host);
  applyTheme(pip.document);
  const unsubscribe = store.subscribe(() => applyTheme(pip.document));
  pip.document.addEventListener('keydown', (e) => handleKeys(e, pip.document));
  render(<CompactView floating />, host);
  pip.addEventListener('pagehide', () => {
    unsubscribe();
    render(null, host);
    setTimeout(() => activeInput()?.focus(), 0);
  });
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

function HeaderButton({ label, onClick, children, pressed }: { label: string; onClick: (e: MouseEvent) => void; children: preact.ComponentChildren; pressed?: boolean }) {
  return (
    <button class="icon-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

function Header({ compact, floating, narrow }: { compact: boolean; floating: boolean; narrow: boolean }) {
  const s = useStore();
  const [help, setHelp] = useState<Anchor | null>(null);
  if (!floating)
    helpOpener = (anchor) => {
      const el = document.querySelector('[data-help]');
      setHelp(anchor ?? (el ? { el } : { x: 16, y: 56 }));
    };
  return (
    <header class="bar">
      <Logo />
      <div class="bar-actions">
        {!compact && (
          <button class="icon-btn" data-help aria-label="How to type measurements (F1)" title="How to type measurements (F1)" onClick={(e) => setHelp(anchorOf(e))}>
            <HelpIcon />
          </button>
        )}
        {!compact && narrow && (
          <HeaderButton label="Tape and saved values" pressed={s.sideOpen} onClick={() => s.setSideOpen(!s.sideOpen)}>
            <TapeIcon />
          </HeaderButton>
        )}
        {!floating && canPopOut() && (
          <HeaderButton label="Keep on top (floating window)" onClick={() => void popOut()}>
            <PopOutIcon />
          </HeaderButton>
        )}
        {!floating && (
          <HeaderButton label={compact ? 'Full layout (Ctrl+M)' : 'Compact layout (Ctrl+M)'} onClick={() => s.toggleLayout()}>
            {compact ? <ExpandIcon /> : <CompactIcon />}
          </HeaderButton>
        )}
        {!floating && (
          <HeaderButton label="Settings (Ctrl+,)" onClick={() => s.openSettings(true)}>
            <SettingsIcon />
          </HeaderButton>
        )}
      </div>
      {help && <Help anchor={help} onClose={() => setHelp(null)} />}
    </header>
  );
}

// ---------------- Layouts ----------------

function useWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  const [height, setHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = (): void => {
      setWidth(window.innerWidth);
      setHeight(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  void height;
  return width;
}

function FullView() {
  const s = useStore();
  const width = useWidth();
  const docked = width >= 900;
  useEffect(() => {
    if (docked && s.sideOpen) s.setSideOpen(false);
  }, [docked]);
  return (
    <div class="app full">
      <Header compact={false} floating={false} narrow={!docked} />
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
            <button class="icon-btn drawer-close" aria-label="Close" onClick={() => s.setSideOpen(false)}>
              <CloseIcon />
            </button>
            <SidePanel />
          </aside>
        </div>
      )}
    </div>
  );
}

export function CompactView({ floating = false }: { floating?: boolean }) {
  return (
    <div class={`app compact ${floating ? 'floating' : ''}`}>
      <Header compact floating={floating} narrow />
      <main class="compact-main">
        <Display compact />
        <Tiles compact />
        <SavedChips />
      </main>
    </div>
  );
}

function Notices() {
  const s = useStore();
  const [warning, setWarning] = useState(s.startupWarning);
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
      <div class="notice-host" aria-live="polite">
        {s.notice && (
          <div class={`notice ${s.notice.kind}`} key={s.notice.id}>
            <span>{s.notice.text}</span>
            {s.notice.kind === 'undo' && (
              <button class="link" onClick={() => s.undo()}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function App() {
  const s = useStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => handleKeys(e, document);
    document.addEventListener('keydown', onKey);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = (): void => applyTheme(document);
    media.addEventListener('change', onScheme);
    const onHide = (): void => store.saveNow();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    setTimeout(() => activeInput()?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      media.removeEventListener('change', onScheme);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);
  useEffect(() => applyTheme(document));

  return (
    <>
      {s.settingsOpen ? <SettingsPage /> : s.settings.layout === 'Compact' ? <CompactView /> : <FullView />}
      <Notices />
    </>
  );
}
