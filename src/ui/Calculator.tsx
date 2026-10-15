import { Fragment } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { CalcEngine, type HighlightSpan } from '../core/calcEngine';
import type { HyphenAfterFeet } from '../core/parser';
import type { Quantity } from '../core/quantity';
import { CalculatorSession, type TileModel } from '../core/session';
import { CopyOptions } from './CopyOptions';
import { ExpressionInput, activeInput } from './ExpressionInput';
import { BackspaceIcon, ChevronIcon, CopyIcon, ExportIcon, MoreIcon, TrashIcon } from './icons';
import { Anchor, Menu, MenuItem, Popover, anchorOf, longPress } from './Popover';
import { store, useStore } from './store';

const insert = (text: string): void => activeInput()?.insert(text);
const focusInput = (): void => activeInput()?.focus();

/** Text with its operators tinted, as in the input. */
export function Highlighted({ text, spans }: { text: string; spans: readonly HighlightSpan[] }) {
  const parts: preact.JSX.Element[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start > at) parts.push(<Fragment key={at}>{text.slice(at, span.start)}</Fragment>);
    parts.push(
      <span key={span.start} class="op">
        {text.slice(span.start, span.end)}
      </span>,
    );
    at = span.end;
  }
  if (at < text.length) parts.push(<Fragment key={at}>{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

// ---------------- Copy button ----------------

/** Copy (one click, the remembered format) with an arrow for copy options. */
export function CopyButton() {
  const s = useStore();
  const [options, setOptions] = useState<Anchor | null>(null);
  copyOptionsOpener = (anchor) => setOptions(anchor);
  return (
    <div class="split" data-copy-anchor>
      <button class="btn split-main" onClick={(e) => {
          s.copyCurrent(e.shiftKey);
          focusInput();
        }}
        title={s.copyTooltip} disabled={!s.session.canCopy}>
        <CopyIcon />
        <span>{s.session.copyLabel}</span>
      </button>
      <button class="btn split-more" aria-label="Copy options (Ctrl+Shift+C)" title="Copy options (Ctrl+Shift+C)" onClick={(e) => setOptions(anchorOf(e))}>
        <ChevronIcon />
      </button>
      {options && <CopyOptions anchor={options} onClose={() => setOptions(null)} />}
    </div>
  );
}

let copyOptionsOpener: ((anchor: Anchor) => void) | null = null;

/** Ctrl+Shift+C: opens copy options under the visible copy button. */
export function openCopyOptions(doc: Document = document): void {
  const el = doc.querySelector('[data-copy-anchor]');
  if (el && copyOptionsOpener) copyOptionsOpener({ el });
}

// ---------------- Save as ----------------

/** Asks for a name and saves `value` (or the current result). */
export function SaveAs(props: { anchor: Anchor; onClose: () => void; value?: Quantity; source?: string; formatId?: string | null }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = (): void => {
    const problem = store.save(name, props.value ?? null, props.source ?? null, props.formatId ?? null);
    setError(problem);
    if (!problem) {
      props.onClose();
      focusInput();
    }
  };
  return (
    <Popover anchor={props.anchor} onClose={props.onClose} class="small-form" label="Save as">
      <h2 class="pop-title">Save as</h2>
      <input
        type="text"
        value={name}
        placeholder="Name, e.g. wall"
        autoComplete="off"
        spellcheck={false}
        onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
      />
      {error && <p class="error-text">{error}</p>}
      <div class="form-actions">
        <button class="btn accent" onClick={save}>
          Save
        </button>
      </div>
    </Popover>
  );
}

let saveOpener: ((doc: Document) => void) | null = null;

/** Ctrl+S: the Saved tab's name box when the side panel shows, otherwise a small form under Copy. */
export function openSave(doc: Document = document): void {
  if (doc === document && showSavedTab()) {
    setTimeout(() => document.querySelector<HTMLInputElement>('[data-save-name]')?.focus(), 0);
    return;
  }
  saveOpener?.(doc);
}

// ---------------- Display ----------------

export function Display({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const session = s.session;
  const display = session.display;
  const [saveAt, setSaveAt] = useState<Anchor | null>(null);
  saveOpener = (doc) => {
    const el = doc.querySelector('[data-copy-anchor]');
    if (el) setSaveAt({ el });
  };
  const typing = session.isTyping;
  const errorCaption = s.errorCaption;
  const placeholder = session.answer === null ? (compact ? '5\'6 1/2" + 1.2m' : 'Type a calculation, e.g. 5\'6 1/2" + 1.2m') : '';
  const resultState = session.isStale ? 'is-stale' : typing && !compact ? 'is-preview' : 'is-final';

  return (
    <section class={`display ${compact ? 'compact' : ''}`} aria-label="Calculation">
      <div class="input-row">
        <ExpressionInput class={compact ? 'small' : 'big'} label="Calculation" placeholder={placeholder} />
        {!typing && session.echo && (
          <div class="echo" aria-hidden="true">
            <Highlighted text={session.echo} spans={session.echoSpans} />
          </div>
        )}
      </div>
      <div class={`result ${resultState}`} aria-live="polite">
        {display && (
          <>
            {display.isApprox && <span class="approx">≈</span>}
            <output class="result-text">{display.screenText}</output>
          </>
        )}
      </div>
      <div class="caption-row">
        <div class="caption">
          {errorCaption ? <span class="error-text">{errorCaption}</span> : display && <span>{display.caption}</span>}
          {s.state.memory && <span class="memory">M {s.memoryText}</span>}
        </div>
        <button
          class={`chip ${s.settings.answerFollowsInput ? 'on' : ''}`}
          aria-pressed={s.settings.answerFollowsInput}
          title="Answer in the first unit typed (Ctrl+U)"
          onClick={() => {
            s.setAnswerFollowsInput(!s.settings.answerFollowsInput);
            focusInput();
          }}
        >
          Auto
        </button>
        <CopyButton />
      </div>
      {saveAt && <SaveAs anchor={saveAt} onClose={() => setSaveAt(null)} />}
    </section>
  );
}

// ---------------- Tiles ----------------

function Tile({ tile, compact }: { tile: TileModel; compact: boolean }) {
  const s = useStore();
  const [menu, setMenu] = useState<Anchor | null>(null);
  const press = longPress(setMenu);
  const copy = (withUnit: boolean): void => void s.copy(s.session.tileCopyText(tile.format, withUnit));
  const items: MenuItem[] = [
    { label: 'Copy', action: () => copy(false) },
    { label: 'Copy with unit', action: () => copy(true) },
    { label: `Show answers in ${tile.format.label.toLowerCase()}`, action: () => s.pickUnit(tile.format) },
  ];
  return (
    <div class={`tile ${tile.isPrimary ? 'primary' : ''}`} {...press.handlers}>
      <button
        class="tile-main"
        title={`Show answers in ${tile.format.label.toLowerCase()}`}
        aria-label={`${tile.format.label}: ${tile.isApprox ? 'about ' : ''}${tile.value}`}
        aria-pressed={tile.isPrimary}
        onClick={() => {
          if (press.consumed()) return;
          s.pickUnit(tile.format);
          focusInput();
        }}
      >
        {!compact && <span class="tile-label">{tile.format.label}</span>}
        <span class="tile-value">
          {tile.isApprox && <span class="approx">≈ </span>}
          {tile.value}
        </span>
      </button>
      {!compact && (
        <button
          class="tile-copy"
          title="Copy · Shift+click copies with the unit"
          aria-label={`Copy ${tile.format.label}`}
          onClick={(e) => {
            copy(e.shiftKey);
            focusInput();
          }}
        >
          <CopyIcon />
        </button>
      )}
      {menu && <Menu anchor={menu} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}

export function Tiles({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const display = s.session.display;
  if (!display) return <div class="tiles empty" />;
  if (display.value.power === 0)
    return compact ? null : (
      <div class="tiles empty">
        <p class="muted">Plain number · no units</p>
      </div>
    );
  return (
    <div class={`tiles ${compact ? 'chips' : ''} ${s.session.isStale ? 'stale' : ''}`} role="group" aria-label="Every unit">
      {display.tiles.map((t) => (
        <Tile key={t.format.id} tile={t} compact={compact} />
      ))}
    </div>
  );
}

// ---------------- Keypad ----------------

type Key = { label: preact.ComponentChild; insert?: string; action?: string; kind?: string; title?: string; menu?: MenuItem[] };

const keys: Key[] = [
  { label: 'ans', insert: 'ans', kind: 'fn', title: 'Last answer' },
  { label: 'to', insert: ' to ', kind: 'op', title: 'Show in a unit, e.g. … to mm' },
  { label: 'MR', action: 'mr', kind: 'fn', title: 'Recall memory · right-click or hold to clear', menu: [{ label: 'Clear memory (MC)', action: () => store.memoryClear() }] },
  { label: 'M+', action: 'm+', kind: 'fn', title: 'Add to memory · right-click or hold to subtract', menu: [{ label: 'Subtract from memory (M−)', action: () => store.memoryAdd(-1) }] },
  { label: <>ft <span class="mark">'</span></>, insert: "'", kind: 'unit', title: 'Feet' },
  { label: <>in <span class="mark">"</span></>, insert: '"', kind: 'unit', title: 'Inches' },

  { label: 'C', action: 'clear', kind: 'clear', title: 'Clear (Esc)' },
  { label: '(', insert: '(', kind: 'fn' },
  { label: ')', insert: ')', kind: 'fn' },
  { label: <BackspaceIcon />, action: 'back', kind: 'fn', title: 'Backspace' },
  { label: 'm', insert: 'm', kind: 'unit' },
  { label: 'mm', insert: 'mm', kind: 'unit' },

  { label: '7', insert: '7' },
  { label: '8', insert: '8' },
  { label: '9', insert: '9' },
  { label: '÷', insert: ' / ', kind: 'op' },
  { label: 'cm', insert: 'cm', kind: 'unit' },
  { label: 'yd', insert: 'yd', kind: 'unit' },

  { label: '4', insert: '4' },
  { label: '5', insert: '5' },
  { label: '6', insert: '6' },
  { label: '×', insert: ' x ', kind: 'op' },
  { label: <span class="stack"><b>6 ½</b><small>space</small></span>, insert: ' ', kind: 'unit', title: 'Space between inches and a fraction: 6␣1/2' },
  { label: <span class="stack"><b>⁄</b><small>fraction</small></span>, insert: '/', kind: 'unit', title: 'Fraction bar: 3/16' },

  { label: '1', insert: '1' },
  { label: '2', insert: '2' },
  { label: '3', insert: '3' },
  { label: '−', insert: ' - ', kind: 'op' },
  { label: <>x<sup>2</sup></>, insert: '²', kind: 'unit', title: 'Square' },
  { label: '√', insert: 'sqrt(', kind: 'unit', title: 'Square root' },

  { label: '0', insert: '0' },
  { label: '.', insert: '.' },
  { label: '%', insert: '%', kind: 'op' },
  { label: '+', insert: ' + ', kind: 'op' },
  { label: '=', action: 'enter', kind: 'equals', title: 'Add to tape (Enter)' },
];

function runKey(key: Key): void {
  if (key.insert !== undefined) {
    insert(key.insert);
    return;
  }
  switch (key.action) {
    case 'clear':
      store.clear();
      break;
    case 'back':
      activeInput()?.backspace();
      break;
    case 'enter':
      store.commit();
      break;
    case 'mr':
      if (store.state.memory === null) store.toast('Memory is empty');
      else insert('mem');
      break;
    case 'm+':
      store.memoryAdd(1);
      break;
  }
  focusInput();
}

function KeyButton({ k }: { k: Key }) {
  const [menu, setMenu] = useState<Anchor | null>(null);
  const press = k.menu ? longPress(setMenu) : null;
  return (
    <>
      <button
        class={`key ${k.kind ?? 'digit'}`}
        title={k.title}
        aria-label={typeof k.label === 'string' ? undefined : k.title}
        // Keep the caret in the calculation box: the keypad never takes focus.
        onMouseDown={(e) => e.preventDefault()}
        {...(press?.handlers ?? {})}
        onPointerDown={(e) => {
          if (e.pointerType === 'touch') e.preventDefault();
          press?.handlers.onPointerDown(e);
        }}
        onClick={() => {
          if (press?.consumed()) return;
          runKey(k);
        }}
      >
        {k.label}
      </button>
      {menu && k.menu && <Menu anchor={menu} items={k.menu} onClose={() => setMenu(null)} />}
    </>
  );
}

export function Keypad() {
  return (
    <div class="keypad" role="group" aria-label="Keypad">
      {keys.map((k, i) => (
        <KeyButton key={i} k={k} />
      ))}
    </div>
  );
}

// ---------------- Tape ----------------

function TapeRow({ id }: { id: string }) {
  const s = useStore();
  const session = s.session;
  const entry = s.state.tape.find((e) => e.id === id)!;
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [form, setForm] = useState<{ kind: 'save' | 'note'; anchor: Anchor } | null>(null);
  const press = longPress(setMenu);
  const time = new Date(entry.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const insertValue = (): void => insert(CalculatorSession.tapeInsertText(entry));
  const items: MenuItem[] = [
    { label: 'Copy result', action: () => void s.copy(session.copyFormat(entry.value, entry.formatId)) },
    { label: 'Insert result', action: insertValue },
    { label: 'Save as value…', action: () => setForm({ kind: 'save', anchor: menuAnchor() }) },
    { label: 'Note…', action: () => setForm({ kind: 'note', anchor: menuAnchor() }) },
    { label: 'Delete', action: () => s.deleteTape(entry.id), danger: true },
  ];
  const rowRef = useRef<HTMLLIElement>(null);
  const menuAnchor = (): Anchor => ({ el: rowRef.current! });

  return (
    <li class="tape-row" ref={rowRef} {...press.handlers}>
      <button
        class="tape-main"
        title="Click to edit again. Right-click for more."
        onClick={() => {
          if (press.consumed()) return;
          if (session.input.trim().length === 0) s.setInput(entry.input);
          else insertValue();
          s.setSideOpen(false);
          focusInput();
        }}
      >
        <span class="tape-input">
          <Highlighted text={entry.input} spans={highlightOf(entry.input, entry.hyphen)} />
        </span>
        <span class="tape-time">{time}</span>
        <span class="tape-result">{session.formatPrimary(entry.value, entry.formatId)}</span>
        {entry.note && <span class="tape-note">{entry.note}</span>}
      </button>
      <button class="icon-btn row-more" aria-label="More" onClick={(e) => setMenu(anchorOf(e))}>
        <MoreIcon />
      </button>
      {menu && <Menu anchor={menu} items={items} onClose={() => setMenu(null)} />}
      {form?.kind === 'save' && (
        <SaveAs anchor={form.anchor} onClose={() => setForm(null)} value={entry.value} source={entry.input} formatId={entry.formatId} />
      )}
      {form?.kind === 'note' && <NoteForm anchor={form.anchor} id={entry.id} note={entry.note ?? ''} onClose={() => setForm(null)} />}
    </li>
  );
}

const highlightOf = (input: string, hyphen: HyphenAfterFeet): HighlightSpan[] => CalcEngine.highlight(input, hyphen);

function NoteForm({ anchor, id, note, onClose }: { anchor: Anchor; id: string; note: string; onClose: () => void }) {
  const [text, setText] = useState(note);
  const apply = (value: string | null): void => {
    store.setNote(id, value);
    onClose();
    focusInput();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} class="small-form" label="Note">
      <h2 class="pop-title">Note</h2>
      <input
        type="text"
        value={text}
        placeholder="e.g. kitchen floor"
        onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), apply(text))}
      />
      <div class="form-actions">
        {note.length > 0 && (
          <button class="btn" onClick={() => apply(null)}>
            Remove
          </button>
        )}
        <button class="btn accent" onClick={() => apply(text)}>
          Save
        </button>
      </div>
    </Popover>
  );
}

function downloadFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { downloadFile };

const today = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function TapePanel() {
  const s = useStore();
  const tape = s.state.tape;
  const [confirm, setConfirm] = useState<Anchor | null>(null);
  const copyAll = async (): Promise<void> => {
    const text = s.session.tapeAsText();
    if (text.length === 0) s.toast('The tape is empty');
    else await s.copy(text, `Copied ${tape.length} tape entr${tape.length === 1 ? 'y' : 'ies'}`);
  };
  const exportCsv = (): void => {
    if (tape.length === 0) {
      s.toast('The tape is empty');
      return;
    }
    // A byte-order mark so Excel opens the file as UTF-8 (², ³, ″).
    downloadFile(`Cubit tape ${today()}.csv`, '﻿' + s.session.tapeAsCsv(), 'text/csv;charset=utf-8');
    s.toast('Exported the tape as CSV');
  };
  return (
    <>
      {tape.length === 0 ? (
        <div class="empty-state">
          <p class="empty-title">No calculations yet</p>
          <p class="muted">Press Enter or = to keep a result here. Click an entry to edit it again.</p>
        </div>
      ) : (
        <ol class="tape" aria-label="Tape">
          {[...tape].reverse().map((e) => (
            <TapeRow key={e.id} id={e.id} />
          ))}
        </ol>
      )}
      <div class="side-actions">
        <button class="btn" title="Copy the whole tape as text" onClick={copyAll}>
          <CopyIcon /> Copy all
        </button>
        <button class="btn" title="Save the tape as a CSV file for Excel" onClick={exportCsv}>
          <ExportIcon /> Export
        </button>
        <button class="btn icon-only" aria-label="Clear the tape" title="Clear the tape" disabled={tape.length === 0} onClick={(e) => setConfirm(anchorOf(e))}>
          <TrashIcon />
        </button>
      </div>
      {confirm && (
        <Popover anchor={confirm} onClose={() => setConfirm(null)} class="small-form" label="Clear tape">
          <p>Clear every entry on the tape?</p>
          <div class="form-actions">
            <button
              class="btn danger"
              data-autofocus
              onClick={() => {
                s.clearTape();
                setConfirm(null);
              }}
            >
              Clear tape
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

// ---------------- Saved values ----------------

function SavedRow({ name, index }: { name: string; index: number }) {
  const s = useStore();
  const saved = s.state.savedValues.find((v) => v.name === name)!;
  const [menu, setMenu] = useState<Anchor | null>(null);
  const press = longPress(setMenu);
  const items: MenuItem[] = [
    { label: 'Insert', action: () => insert('@' + saved.name) },
    { label: 'Copy value', action: () => void s.copy(s.session.copyFormat(saved.value, saved.formatId)) },
    { label: 'Delete', action: () => s.deleteSaved(saved.name), danger: true },
  ];
  return (
    <li class="saved-row" {...press.handlers}>
      <button
        class="saved-main"
        title="Click to insert. Right-click for more."
        onClick={() => {
          if (press.consumed()) return;
          insert('@' + saved.name);
          s.setSideOpen(false);
        }}
      >
        <span class="saved-name">@{saved.name}</span>
        {index < 9 && <kbd class="shortcut">Ctrl+{index + 1}</kbd>}
        <span class="saved-value">{s.session.formatPrimary(saved.value, saved.formatId)}</span>
        <span class="saved-source">{saved.source}</span>
      </button>
      <button class="icon-btn row-more" aria-label="More" onClick={(e) => setMenu(anchorOf(e))}>
        <MoreIcon />
      </button>
      {menu && <Menu anchor={menu} items={items} onClose={() => setMenu(null)} />}
    </li>
  );
}

function SavedPanel() {
  const s = useStore();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = (): void => {
    const problem = s.save(name);
    setError(problem);
    if (!problem) {
      setName('');
      focusInput();
    }
  };
  return (
    <>
      <div class="save-box">
        <input
          type="text"
          data-save-name
          value={name}
          placeholder="Name, e.g. wall"
          aria-label="Name for the current result"
          autoComplete="off"
          spellcheck={false}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
        />
        <button class="btn" title="Save the current result (Ctrl+S)" onClick={save}>
          Save result
        </button>
      </div>
      {error && <p class="error-text pad">{error}</p>}
      {s.state.savedValues.length === 0 ? (
        <div class="empty-state">
          <p class="empty-title">No saved values</p>
          <p class="muted">Save a result with a name, then use it in any calculation as @name.</p>
        </div>
      ) : (
        <ul class="saved">
          {s.state.savedValues.map((v, i) => (
            <SavedRow key={v.name} name={v.name} index={i} />
          ))}
        </ul>
      )}
    </>
  );
}

/** Saved values as chips (compact layout). */
export function SavedChips() {
  const s = useStore();
  if (s.state.savedValues.length === 0) return null;
  return (
    <div class="saved-chips">
      {s.state.savedValues.map((v) => (
        <button key={v.name} class="chip" title={s.session.formatPrimary(v.value, v.formatId)} onMouseDown={(e) => e.preventDefault()} onClick={() => insert('@' + v.name)}>
          @{v.name}
        </button>
      ))}
    </div>
  );
}

export function SidePanel() {
  const [tab, setTab] = useState<'tape' | 'saved'>('tape');
  sideTabSetter = setTab;
  return (
    <div class="side-panel">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tape'} class={tab === 'tape' ? 'on' : ''} onClick={() => setTab('tape')}>
          Tape
        </button>
        <button role="tab" aria-selected={tab === 'saved'} class={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>
          Saved values
        </button>
      </div>
      <div class="side-body">{tab === 'tape' ? <TapePanel /> : <SavedPanel />}</div>
    </div>
  );
}

let sideTabSetter: ((tab: 'tape' | 'saved') => void) | null = null;

/** Switches the side panel to Saved values (Ctrl+S while it's visible). */
export function showSavedTab(): boolean {
  const panel = document.querySelector<HTMLElement>('.side-panel');
  if (!sideTabSetter || !panel || panel.offsetParent === null) return false;
  sideTabSetter('saved');
  return true;
}
