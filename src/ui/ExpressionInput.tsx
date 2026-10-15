import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { HighlightSpan } from '../core/calcEngine';
import { store, useStore } from './store';

/** What the keypad and shortcuts need from whichever calculation box is on screen. */
export interface InputApi {
  insert(text: string): void;
  backspace(): void;
  focus(): void;
  selectAll(): void;
  hasSelection(): boolean;
}

let active: InputApi | null = null;
const mounted: InputApi[] = [];

/** The calculation box currently on screen (full or compact layout). */
export const activeInput = (): InputApi | null => active;

export const isTouch = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

interface Segment {
  text: string;
  op: boolean;
  error: boolean;
}

/** Splits the text where an operator colour or the error underline starts or stops. */
function segments(text: string, spans: readonly HighlightSpan[], error: { start: number; end: number } | null): Segment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const s of spans) cuts.add(s.start).add(s.end);
  if (error) cuts.add(error.start).add(error.end);
  const points = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (a === b) continue;
    out.push({
      text: text.slice(a, b),
      op: spans.some((s) => s.start <= a && b <= s.end),
      error: error !== null && error.start <= a && b <= error.end,
    });
  }
  return out;
}

/** Turns pasted text into one line, as typed. */
const oneLine = (text: string): string => text.split(/[\r\n\t]+/).filter((p) => p.trim().length > 0).join(' ').trim();

interface Props {
  class?: string;
  placeholder?: string;
  label: string;
}

/**
 * The calculation input: a plain single-line box whose operators are tinted with the accent colour and
 * whose rejected part gets a wavy underline. The colours come from CalcEngine.highlight, which uses the
 * same token decisions as the calculation, so 4'-2" (one measurement) and 4' - 2" (a subtraction) look
 * different exactly when they calculate differently.
 *
 * The real <input> keeps native caret, selection and IME; its text is transparent and a mirror behind it
 * draws the colours. Native undo can't follow programmatic edits (written-in units, keypad), so the box
 * keeps its own text-only history: Ctrl+Z only ever undoes typing.
 */
export function ExpressionInput({ class: className, placeholder, label }: Props) {
  const s = useStore();
  const session = s.session;
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  const [ghostWidth, setGhostWidth] = useState(0);
  const history = useRef({ steps: [{ text: '', caret: 0 }], index: 0, lastTyped: 0 });
  const shown = useRef('');

  const el = (): HTMLInputElement => inputRef.current!;
  const caret = (): number => el().selectionEnd ?? el().value.length;

  const record = (text: string, at: number, typing: boolean): void => {
    const h = history.current;
    const now = Date.now();
    h.steps.splice(h.index + 1);
    // Consecutive keystrokes within a second merge into one undo step, like other editors.
    if (typing && h.index > 0 && now - h.lastTyped < 1000) h.steps[h.index] = { text, caret: at };
    else {
      h.steps.push({ text, caret: at });
      h.index++;
      if (h.steps.length > 300) {
        h.steps.shift();
        h.index--;
      }
    }
    h.lastTyped = typing ? now : 0;
  };

  const syncMirror = (): void => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
  };

  /**
   * Assumed units: the number being typed shows its unit as ghost text; once the caret has moved past a
   * number, its unit is written in for real (CalculatorSession.hintsAt).
   */
  const syncHints = (): void => {
    const input = inputRef.current;
    if (!input || input.value !== store.session.input) return;
    if ((input.selectionStart ?? 0) !== (input.selectionEnd ?? 0)) {
      setGhost(null); // never rewrite the text under a selection
      return;
    }
    const at = caret();
    const hints = store.hintsAt(at);
    if (hints.write.length > 0) {
      let text = input.value;
      let newCaret = at;
      for (let i = hints.write.length - 1; i >= 0; i--) {
        const w = hints.write[i];
        text = text.slice(0, w.position) + w.text + text.slice(w.position);
        if (w.position < at) newCaret += w.text.length;
      }
      input.value = text;
      shown.current = text;
      input.setSelectionRange(newCaret, newCaret);
      // It belongs to the keystroke that caused it, so one Ctrl+Z undoes both.
      const h = history.current;
      h.steps[h.index] = { text, caret: newCaret };
      store.setInput(text);
      setGhost(null);
      return;
    }
    setGhost(hints.ghost?.text ?? null);
  };

  const edited = (previous: string, current: string, typing: boolean): void => {
    store.historyIndex = -1;
    const input = el();
    const continued = store.continueFromAnswer(previous, current);
    if (continued !== null) {
      current = continued;
      input.value = current;
      input.setSelectionRange(current.length, current.length);
    }
    record(current, caret(), typing && continued === null);
    shown.current = current;
    store.setInput(current);
    queueMicrotask(syncHints);
  };

  const stepHistory = (direction: number): void => {
    const h = history.current;
    const target = h.index + direction;
    if (target < 0 || target >= h.steps.length) return;
    h.index = target;
    h.lastTyped = 0;
    const { text, caret: at } = h.steps[target];
    const input = el();
    input.value = text;
    shown.current = text;
    const c = at < text.length ? at : text.length;
    input.setSelectionRange(c, c);
    store.historyIndex = -1;
    store.setInput(text);
  };

  const api: InputApi = {
    insert(text: string) {
      const input = el();
      const previous = input.value;
      const start = input.selectionStart ?? previous.length;
      const end = input.selectionEnd ?? previous.length;
      input.setRangeText(text, start, end, 'end');
      edited(previous, input.value, false);
      api.focus();
    },
    backspace() {
      const input = el();
      const previous = input.value;
      let start = input.selectionStart ?? previous.length;
      const end = input.selectionEnd ?? previous.length;
      if (start === end) {
        if (start === 0) return;
        start--;
      }
      input.setRangeText('', start, end, 'end');
      edited(previous, input.value, false);
      api.focus();
    },
    focus() {
      inputRef.current?.focus({ preventScroll: true });
    },
    selectAll() {
      const input = el();
      input.focus();
      input.select();
    },
    hasSelection() {
      const input = inputRef.current;
      return !!input && document.activeElement === input && (input.selectionStart ?? 0) !== (input.selectionEnd ?? 0);
    },
  };

  // The keypad and shortcuts type into the box that was shown or focused last (main page or floating window).
  // The API only touches refs and the store, so the first render's copy stays valid.
  const apiRef = useRef(api);
  useEffect(() => {
    const mine = apiRef.current;
    mounted.push(mine);
    active = mine;
    return () => {
      mounted.splice(mounted.indexOf(mine), 1);
      if (active === mine) active = mounted[mounted.length - 1] ?? null;
    };
  }, []);

  // Text set from outside (Enter, ↑/↓, a tape entry): show it with the caret at the end, as one undo step.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (input.value !== session.input) {
      input.value = session.input;
      shown.current = session.input;
      if (document.activeElement === input) input.setSelectionRange(session.input.length, session.input.length);
      record(session.input, session.input.length, false);
      setGhost(null);
      queueMicrotask(syncHints);
    }
    requestAnimationFrame(syncMirror);
  });

  useLayoutEffect(() => {
    setGhostWidth(ghost && ghostRef.current ? ghostRef.current.getBoundingClientRect().width : 0);
  }, [ghost]);

  // A freshly shown box (layout switch, Settings closed) takes the keyboard, as in the desktop app,
  // unless that would pop up a phone's keyboard.
  useEffect(() => {
    const doc = inputRef.current?.ownerDocument;
    const idle = !doc?.activeElement || doc.activeElement === doc.body;
    if (idle && !(isTouch() && store.settings.deviceKeyboard)) api.focus();
  }, []);

  useEffect(() => {
    const onSelection = (): void => {
      if (document.activeElement === inputRef.current) setTimeout(syncHints, 0);
      syncMirror();
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const onKeyDown = (e: KeyboardEvent): void => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        stepHistory(-1);
        e.preventDefault();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        stepHistory(+1);
        e.preventDefault();
      }
      return;
    }
    if (e.altKey && !ctrl) {
      const mark = e.code === 'KeyF' ? "'" : e.code === 'KeyI' ? '"' : null;
      if (mark) {
        api.insert(mark);
        e.preventDefault();
      }
      return;
    }
    if (e.isComposing) return;
    switch (e.key) {
      case 'Enter':
        store.commit();
        e.preventDefault();
        break;
      case 'Escape':
        if (store.settingsOpen || store.sideOpen) return; // the page closes those first
        store.clear();
        e.preventDefault();
        break;
      case 'ArrowUp': {
        const text = store.recall(+1);
        if (text !== null) store.setInput(text);
        e.preventDefault();
        break;
      }
      case 'ArrowDown': {
        if (store.historyIndex < 0) return;
        const text = store.recall(-1);
        if (text !== null) store.setInput(text);
        e.preventDefault();
        break;
      }
    }
  };

  const onBeforeInput = (e: InputEvent): void => {
    // The browser's own undo (e.g. from the context menu) can't see our edits; use the text-only history.
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      stepHistory(e.inputType === 'historyUndo' ? -1 : +1);
    }
  };

  const onInput = (): void => {
    const previous = shown.current;
    const current = el().value;
    if (current === previous) return;
    edited(previous, current, Math.abs(current.length - previous.length) === 1);
  };

  const onPaste = (e: ClipboardEvent): void => {
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    api.insert(oneLine(text));
  };

  const errorRange = s.errorRange;
  const parts = segments(session.input, session.highlights, errorRange);
  const deviceKeyboard = s.settings.deviceKeyboard || !isTouch();

  return (
    <div class={`expr ${className ?? ''}`} style={{ '--ghost-w': `${ghostWidth}px` }} title={errorRange ? (session.error ?? undefined) : undefined}>
      <div class="expr-mirror" ref={mirrorRef} aria-hidden="true">
        {parts.map((p, i) => (
          <span key={i} class={(p.op ? 'op' : '') + (p.error ? ' err' : '')}>
            {p.text}
          </span>
        ))}
        {ghost && (
          <span class="ghost" ref={ghostRef}>
            {ghost}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        class="expr-input"
        type="text"
        aria-label={label}
        aria-invalid={errorRange ? 'true' : undefined}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellcheck={false}
        enterKeyHint="go"
        inputMode={deviceKeyboard ? 'text' : 'none'}
        onKeyDown={onKeyDown}
        onBeforeInput={onBeforeInput}
        onInput={onInput}
        onPaste={onPaste}
        onScroll={syncMirror}
        onFocus={() => (active = apiRef.current)}
      />
    </div>
  );
}
