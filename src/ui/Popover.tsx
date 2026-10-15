import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { activeInput, isTouch } from './ExpressionInput';
import { store } from './store';

/** Where a popover opens: under an element, or at a point (a context menu). */
export type Anchor = { el: Element } | { x: number; y: number };

export const anchorOf = (e: Event): Anchor => ({ el: e.currentTarget as Element });
export const pointOf = (e: MouseEvent): Anchor => ({ x: e.clientX, y: e.clientY });

/** Open popovers, newest last: Esc closes only the top one. */
const openStack: HTMLElement[] = [];

interface Props {
  anchor: Anchor;
  onClose: () => void;
  children: ComponentChildren;
  class?: string;
  label?: string;
  /** Prefer opening to the left of the anchor's right edge (menus near the right side). */
  align?: 'start' | 'end';
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? (hi < lo ? lo : hi) : v);

const focusables = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );

/**
 * A floating panel next to its anchor. Esc or a click outside closes it, Tab stays inside it, and when it
 * closes the calculation box gets the keyboard back. On a phone-width screen it becomes a sheet at the
 * bottom, where thumbs can reach it.
 */
export function Popover({ anchor, onClose, children, class: className, label, align = 'end' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Placed next to the anchor, and placed again when the panel grows (an error, "Custom…") or the window resizes.
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const place = (): void => {
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left: number;
      let top: number;
      if ('el' in anchor) {
        const r = anchor.el.getBoundingClientRect();
        left = align === 'end' ? r.right - w : r.left;
        top = r.bottom + 6;
        if (top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      } else {
        left = anchor.x;
        top = anchor.y;
        if (left + w > vw - 8) left = anchor.x - w;
        if (top + h > vh - 8) top = anchor.y - h;
      }
      setPos({ left: clamp(left, 8, vw - w - 8), top: clamp(top, 8, vh - h - 8) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  useEffect(() => {
    const panel = ref.current!;
    openStack.push(panel);
    const onKey = (e: KeyboardEvent): void => {
      if (openStack[openStack.length - 1] !== panel) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        close.current();
      } else if (e.key === 'Tab') {
        // Keep Tab inside the panel while it's open.
        const items = focusables(panel);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    // Focus the first field, or the panel itself so Esc works.
    const first = panel.querySelector<HTMLElement>('input:not([type="checkbox"]), select, [data-autofocus]');
    (first ?? panel).focus({ preventScroll: true });
    if (first instanceof HTMLInputElement && first.dataset.selectAll !== undefined) first.select();
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openStack.splice(openStack.indexOf(panel), 1);
      // Hand the keyboard back to the calculation (not the phone keyboard).
      setTimeout(() => {
        if (openStack.length > 0 || store.settingsOpen) return;
        const active = document.activeElement;
        const lost = !active || active === document.body || !active.isConnected || active.tagName === 'BUTTON';
        if (lost && !(isTouch() && store.settings.deviceKeyboard)) activeInput()?.focus();
      }, 0);
    };
  }, []);

  return (
    <div class="popover-layer">
      {/* Closing on click (not pointerdown) means the tap that closes a sheet can't also press what's under it. */}
      <div class="popover-backdrop" onClick={() => close.current()} onContextMenu={(e) => (e.preventDefault(), close.current())} />
      <div
        ref={ref}
        class={`popover ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        // Until it's placed it's transparent, not hidden: hidden elements can't take the keyboard focus.
        style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { left: '0px', top: '0px', opacity: 0 }}
      >
        {children}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

/** A right-click / long-press menu. ↑ ↓ Home End move between items. */
export function Menu({ anchor, items, onClose }: { anchor: Anchor; items: MenuItem[]; onClose: () => void }) {
  const onKeyDown = (e: KeyboardEvent): void => {
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.menu-item')];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const go = (i: number): void => {
      e.preventDefault();
      buttons[(i + buttons.length) % buttons.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(buttons.length - 1);
  };
  return (
    <Popover anchor={anchor} onClose={onClose} class="menu" label="Actions">
      <div role="menu" onKeyDown={onKeyDown}>
        {items.map((item, i) => (
          <button
            key={item.label}
            role="menuitem"
            class={`menu-item${item.danger ? ' danger' : ''}`}
            data-autofocus={i === 0 ? '' : undefined}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}

/**
 * Right-click on a mouse, or press and hold on a touch screen, opens a menu (null: no menu).
 * `handlers` go on the element; `consumed()` tells the click that follows a long press to do nothing.
 */
export function useLongPress(open: ((anchor: Anchor) => void) | null) {
  const state = useRef({ timer: 0, fired: false, open });
  state.current.open = open;
  const cancel = (): void => window.clearTimeout(state.current.timer);
  const handlers = open
    ? {
        onContextMenu: (e: MouseEvent) => {
          e.preventDefault();
          // A keyboard menu key gives no pointer position: open under the element instead.
          const anchor: Anchor = e.clientX || e.clientY ? pointOf(e) : { el: e.currentTarget as Element };
          if (!state.current.fired) state.current.open?.(anchor); // Android also fires contextmenu after a long press
        },
        onPointerDown: (e: PointerEvent) => {
          state.current.fired = false;
          if (e.pointerType !== 'touch') return;
          const point = { x: e.clientX, y: e.clientY };
          cancel();
          state.current.timer = window.setTimeout(() => {
            state.current.fired = true;
            state.current.open?.(point);
          }, 500);
        },
        onPointerUp: cancel,
        onPointerLeave: cancel,
        onPointerCancel: cancel,
      }
    : {};
  return {
    handlers,
    consumed: (): boolean => {
      const was = state.current.fired;
      state.current.fired = false;
      return was;
    },
  };
}
