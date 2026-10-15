import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Where a popover opens: under an element, or at a point (a context menu). */
export type Anchor = { el: Element } | { x: number; y: number };

export const anchorOf = (e: Event): Anchor => ({ el: e.currentTarget as Element });
export const pointOf = (e: MouseEvent): Anchor => ({ x: e.clientX, y: e.clientY });

interface Props {
  anchor: Anchor;
  onClose: () => void;
  children: ComponentChildren;
  class?: string;
  label?: string;
  /** Prefer opening to the left of the anchor's right edge (menus near the right side). */
  align?: 'start' | 'end';
}

/**
 * A floating panel next to its anchor. Closes on Esc or a click outside. On a phone-width screen it
 * becomes a sheet at the bottom, where thumbs can reach it.
 */
export function Popover({ anchor, onClose, children, class: className, label, align = 'end' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const view = panel.ownerDocument.defaultView!;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = view.innerWidth;
    const vh = view.innerHeight;
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
  }, []);

  useEffect(() => {
    const doc = ref.current!.ownerDocument;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    doc.addEventListener('keydown', onKey, true);
    // Focus the first field, or the panel itself so Esc works.
    const first = ref.current!.querySelector<HTMLElement>('input, select, [data-autofocus]');
    (first ?? ref.current!).focus({ preventScroll: true });
    return () => doc.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div class="popover-layer">
      <div class="popover-backdrop" onPointerDown={(e) => (e.preventDefault(), onClose())} />
      <div
        ref={ref}
        class={`popover ${className ?? ''}`}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { visibility: 'hidden' }}
      >
        {children}
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? (hi < lo ? lo : hi) : v);

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

/** A right-click / long-press menu. */
export function Menu({ anchor, items, onClose }: { anchor: Anchor; items: MenuItem[]; onClose: () => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} class="menu" label="Actions">
      <div role="menu">
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
 * Right-click on a mouse, or press and hold on a touch screen, opens a menu. `handlers` go on the
 * element; `consumed()` tells the click that follows a long press to do nothing.
 */
export function longPress(open: (anchor: Anchor) => void) {
  let timer: number | undefined;
  let fired = false;
  const cancel = (): void => window.clearTimeout(timer);
  return {
    handlers: {
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        if (!fired) open(pointOf(e)); // Android also fires contextmenu after a long press
      },
      onPointerDown: (e: PointerEvent) => {
        fired = false;
        if (e.pointerType !== 'touch') return;
        const point = { x: e.clientX, y: e.clientY };
        timer = window.setTimeout(() => {
          fired = true;
          open(point);
        }, 500);
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
    },
    consumed: (): boolean => {
      const was = fired;
      fired = false;
      return was;
    },
  };
}
