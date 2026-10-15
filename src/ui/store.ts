import { useEffect, useReducer } from 'preact/hooks';
import { AppState, LayoutMode } from '../core/appState';
import type { CopyPreset } from '../core/copyPreset';
import { DisplayFormat, FormatStyle, Formats } from '../core/formats';
import { CopyRounding } from '../core/copyPreset';
import type { Quantity } from '../core/quantity';
import { CalculatorSession, type UnitHints } from '../core/session';
import { StateFormatError, StateStore } from '../core/stateStore';

const StateKey = 'cubit.state';
const ErrorLogKey = 'cubit.errors';
const ErrorDelayMs = 500;
const ToastMs = 1600;
const UndoMs = 6000;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remembers the last few errors so "Download a problem report" has something to show. */
export function logError(message: string): void {
  const log = (readStorage(ErrorLogKey) ?? '').split('\n').filter(Boolean);
  log.push(`${new Date().toISOString()} ${message.replace(/\s+/g, ' ')}`);
  writeStorage(ErrorLogKey, log.slice(-50).join('\n'));
}

export const errorLog = (): string => readStorage(ErrorLogKey) ?? '';

function loadState(): { state: AppState; warning: string | null } {
  const text = readStorage(StateKey);
  if (text === null) return { state: new AppState(), warning: null };
  try {
    return StateStore.fromJson(text);
  } catch (e) {
    if (!(e instanceof StateFormatError)) throw e;
    const aside = `cubit.state.unreadable-${Date.now()}`;
    writeStorage(aside, text);
    return { state: new AppState(), warning: "Cubit couldn't read its saved data and started fresh. The old data was kept aside." };
  }
}

export interface Notice {
  readonly kind: 'toast' | 'undo';
  readonly text: string;
  readonly id: number;
}

/**
 * Binds CalculatorSession (which holds all calculator behaviour and is unit-tested) to the page:
 * change notifications, saving, the short delay before an error is underlined, toasts and undo.
 */
export class Store {
  state: AppState;
  session: CalculatorSession;
  startupWarning: string | null;
  /** The error underline shows after a short pause, so it doesn't flash while typing. */
  errorShown = false;
  /** After Enter on a bad calculation, the short error replaces the caption under the result. */
  errorRevealed = false;
  notice: Notice | null = null;
  historyIndex = -1;
  settingsOpen = false;
  sideOpen = false;
  /** Layout before Settings opened from the compact layout. */
  private layoutBeforeSettings: LayoutMode | null = null;

  private listeners = new Set<() => void>();
  private saveTimer: number | undefined;
  private errorTimer: number | undefined;
  private noticeTimer: number | undefined;
  private noticeId = 0;

  constructor() {
    const { state, warning } = loadState();
    this.state = state;
    this.startupWarning = warning;
    this.session = new CalculatorSession(state);
  }

  get settings() {
    return this.state.settings;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  changed(): void {
    for (const l of this.listeners) l();
  }

  // ---------------- Persistence ----------------

  requestSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  saveNow(): void {
    window.clearTimeout(this.saveTimer);
    if (!writeStorage(StateKey, StateStore.toJson(this.state))) this.toast("Couldn't save your data. It will retry on the next change.");
  }

  /** Replaces everything with an imported data file (a backup or the desktop app's state.json). */
  importState(text: string): string | null {
    try {
      const { state, warning } = StateStore.fromJson(text);
      this.state = state;
      this.session = new CalculatorSession(state);
      this.historyIndex = -1;
      this.saveNow();
      this.changed();
      return warning;
    } catch (e) {
      if (e instanceof StateFormatError) return e.message;
      throw e;
    }
  }

  exportState(): string {
    return StateStore.toJson(this.state);
  }

  // ---------------- Input ----------------

  setInput(text: string): void {
    if (text === this.session.input) return;
    this.session.setInput(text);
    this.errorRevealed = false;
    this.updateError();
    this.changed();
  }

  private updateError(): void {
    window.clearTimeout(this.errorTimer);
    if (this.session.error === null) this.errorShown = false;
    else if (!this.errorShown)
      this.errorTimer = window.setTimeout(() => {
        this.errorShown = true;
        this.changed();
      }, ErrorDelayMs);
  }

  get errorRange() {
    return this.errorShown ? this.session.errorRange : null;
  }

  get errorCaption(): string | null {
    return this.errorRevealed ? this.session.error : null;
  }

  hintsAt(caret: number): UnitHints {
    return this.session.hintsAt(caret);
  }

  continueFromAnswer(previous: string, current: string): string | null {
    return this.session.continueFromAnswer(previous, current);
  }

  /** Adds the current result to the tape. False (and the error is revealed) when it can't be calculated. */
  commit(): boolean {
    if (!this.session.isTyping) return false;
    const entry = this.session.commit();
    this.historyIndex = -1;
    if (entry === null) {
      window.clearTimeout(this.errorTimer);
      this.errorShown = true;
      this.errorRevealed = true;
      this.changed();
      return false;
    }
    this.errorRevealed = false;
    this.updateError();
    this.requestSave();
    this.changed();
    return true;
  }

  /** C / Esc: clears the input, or the answer when the input is already empty. */
  clear(): void {
    this.historyIndex = -1;
    if (this.session.input.length > 0) this.setInput('');
    else {
      this.session.clearAnswer();
      this.changed();
    }
  }

  /** ↑ / ↓ through earlier calculations. Returns the text to show, or null when there's no history. */
  recall(direction: 1 | -1): string | null {
    const history = this.session.history;
    if (history.length === 0) return null;
    if (direction === -1 && this.historyIndex < 0) return null;
    const next = this.historyIndex + direction;
    this.historyIndex = next < -1 ? -1 : next > history.length - 1 ? history.length - 1 : next;
    return this.historyIndex < 0 ? '' : history[this.historyIndex];
  }

  // ---------------- Notices ----------------

  toast(text: string): void {
    this.showNotice('toast', text.length > 60 ? text.slice(0, 57) + '…' : text, ToastMs);
  }

  private undoable(description: string): void {
    this.showNotice('undo', description, UndoMs);
  }

  private showNotice(kind: Notice['kind'], text: string, ms: number): void {
    window.clearTimeout(this.noticeTimer);
    this.notice = { kind, text, id: ++this.noticeId };
    this.noticeTimer = window.setTimeout(() => {
      this.notice = null;
      this.changed();
    }, ms);
    this.changed();
  }

  dismissNotice(): void {
    window.clearTimeout(this.noticeTimer);
    this.notice = null;
    this.changed();
  }

  undo(): void {
    this.dismissNotice();
    if (!this.session.undo()) return;
    this.requestSave();
    this.changed();
  }

  // ---------------- Copy ----------------

  copyText(preset?: CopyPreset): string | null {
    return this.session.copyText(preset);
  }

  /** Puts text on the clipboard and says so. False when there was nothing to copy or the clipboard refused. */
  async copy(text: string | null, confirmation?: string): Promise<boolean> {
    if (!text) {
      this.toast(this.session.isStale ? (this.session.error ?? 'Fix the calculation first') : 'Nothing to copy yet');
      return false;
    }
    if (!(await writeClipboard(text))) {
      this.toast('Clipboard unavailable, try again');
      return false;
    }
    this.toast(confirmation ?? 'Copied ' + text);
    return true;
  }

  copyCurrent(): void {
    void this.copy(this.session.copyText());
  }

  get copyTooltip(): string {
    const preset = this.settings.copyPreset;
    const format = preset.formatId === null ? 'the display format' : (Formats.byId(preset.formatId)?.label ?? 'the display format');
    const rounding =
      preset.rounding === CopyRounding.AsShown
        ? 'as shown'
        : preset.rounding === CopyRounding.Up
          ? 'rounded up'
          : preset.rounding === CopyRounding.Down
            ? 'rounded down'
            : 'rounded to nearest';
    return `Copy in ${format}, ${rounding} (Ctrl+C)`;
  }

  rememberCopyPreset(preset: CopyPreset): void {
    this.settings.copyPreset = preset;
    this.requestSave();
    this.changed();
  }

  // ---------------- Answer unit ----------------

  pickUnit(format: DisplayFormat): void {
    this.session.pickUnit(format);
    this.settingsChanged();
  }

  setAnswerFollowsInput(follow: boolean): void {
    if (follow === this.settings.answerFollowsInput) return;
    this.session.setAnswerFollowsInput(follow);
    this.settingsChanged();
  }

  toggleAuto(): void {
    this.setAnswerFollowsInput(!this.settings.answerFollowsInput);
    const label = this.session.display?.format.label.toLowerCase() ?? 'chosen unit';
    this.toast(this.settings.answerFollowsInput ? 'Answer in first unit typed' : 'Answer in ' + label);
  }

  /** Re-renders everything after a setting changed. */
  settingsChanged(): void {
    this.session.refresh();
    this.updateError();
    this.requestSave();
    this.changed();
  }

  // ---------------- Layout ----------------

  setLayout(layout: LayoutMode): void {
    this.settings.layout = layout;
    this.requestSave();
    this.changed();
  }

  toggleLayout(): void {
    this.setLayout(this.settings.layout === 'Compact' ? 'Full' : 'Compact');
  }

  openSettings(open: boolean): void {
    if (open === this.settingsOpen) return;
    this.settingsOpen = open;
    if (open && this.settings.layout === 'Compact') {
      this.layoutBeforeSettings = 'Compact';
      this.settings.layout = 'Full';
    } else if (!open && this.layoutBeforeSettings) {
      this.settings.layout = this.layoutBeforeSettings;
      this.layoutBeforeSettings = null;
    }
    this.changed();
  }

  setSideOpen(open: boolean): void {
    if (open === this.sideOpen) return;
    this.sideOpen = open;
    this.changed();
  }

  // ---------------- Tape ----------------

  deleteTape(id: string): void {
    if (!this.session.deleteTape(id)) return;
    this.requestSave();
    this.undoable(this.session.lastUndo!.description);
  }

  clearTape(): void {
    if (this.state.tape.length === 0) return;
    this.session.clearTape();
    this.requestSave();
    this.undoable(this.session.lastUndo!.description);
  }

  setNote(id: string, note: string | null): void {
    if (!this.session.setNote(id, note)) return;
    this.requestSave();
    this.changed();
  }

  // ---------------- Saved values ----------------

  /** Null on success, otherwise the reason it couldn't be saved. */
  save(name: string, value: Quantity | null = null, source: string | null = null, formatId: string | null = null): string | null {
    const problem = this.session.save(name, value, source, formatId);
    if (problem) return problem;
    this.updateError();
    this.requestSave();
    this.toast(`Saved as @${name.trim().replace(/^@+/, '')}`);
    return null;
  }

  deleteSaved(name: string): void {
    if (!this.session.deleteSaved(name)) return;
    this.updateError();
    this.requestSave();
    this.undoable(this.session.lastUndo!.description);
  }

  // ---------------- Memory ----------------

  memoryAdd(sign: 1 | -1): void {
    const message = this.session.memoryAdd(sign);
    if (message) {
      this.toast(message);
      return;
    }
    this.updateError();
    this.requestSave();
    this.changed();
  }

  memoryClear(): void {
    this.session.memoryClear();
    this.updateError();
    this.requestSave();
    this.changed();
  }

  get memoryText(): string {
    return this.state.memory ? this.session.formatPrimary(this.state.memory) : '';
  }
}

/** A short unit name for labels: ft-in, in, mm, ft². */
export function shortName(format: DisplayFormat): string {
  return format.style === FormatStyle.FeetInches ? 'ft-in' : format.style === FormatStyle.FractionalInches ? 'in' : (format.unit?.symbol ?? format.label);
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers or a page without focus: fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export const store = new Store();

/** Re-renders the calling component whenever the store changes. */
export function useStore(): Store {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => store.subscribe(() => bump(undefined)), []);
  return store;
}
