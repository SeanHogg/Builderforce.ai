import { useEffect, useState, type RefObject } from 'react';

/**
 * useCollectionFitHeight — the pixel `max-height` that keeps a Collection's
 * header, bulk bar, `<thead>` and footer pinned when it sits UNDER page content
 * inside a scroll root (PRD 47 §3.2).
 *
 * A fixed `calc(100dvh - topbar)` cap ignores the page title above the
 * Collection, so the Collection overflows the visible area: the page scrolls
 * first and the header/footer scroll out of view. This hook measures the scroll
 * root instead and caps the Collection to the space actually left, so only the
 * rows/cards scroll.
 *
 * The scroll root is one of the app's KNOWN bounded scrollers (`SCROLL_ROOTS`),
 * never "any ancestor whose computed overflow-y is auto" (an `overflow-x` only
 * wrapper computes `overflow-y: auto` too, and its height follows its content).
 *
 * Returns `undefined` when there is no scroll root, or it is not scrolling
 * (`.content.app-full-height` is `overflow:hidden` and sizes its child as a
 * flex column), and before the first measurement (SSR / first paint keep the
 * CSS fallback).
 */

/** The app's intentional bounded scrollers: the shell content area, a panel body, or an opt-in root. */
export const SCROLL_ROOTS = '[data-scroll-root], .content, .ui-panel-body';

/** Below this many px of room under the page content, fall back to the full viewport. */
export const MIN_FIT_HEIGHT = 420;

/** Space after the Collection up to this many px (a wrapper's padding, a short note) is kept in view. */
export const MAX_TRAILING_SPACE = 96;

export interface FitHeightInput {
  /** The scroller's content-box height (clientHeight minus vertical padding). */
  available: number;
  /** The Collection's top relative to the scroller's content start (scroll-invariant). */
  offset: number;
  /** Space after the Collection's bottom border up to the scroller's content end. */
  trailing?: number;
}

/**
 * The pure sizing rule. Fill the room left under the page content (minus a
 * small trailing space, so that stays visible too) when it is at least
 * `min(available, MIN_FIT_HEIGHT)`. Otherwise the Collection starts far down
 * the page, so size it to the whole visible area: scrolled to, it fits the
 * viewport exactly.
 */
export function computeCollectionFitHeight({ available, offset, trailing = 0 }: FitHeightInput): number {
  const room = Math.max(0, available);
  const tail = trailing > 0 && trailing <= MAX_TRAILING_SPACE ? trailing : 0;
  const fit = room - offset - tail;
  return fit >= Math.min(room, MIN_FIT_HEIGHT) ? fit : room;
}

function scrollsVertically(el: Element): boolean {
  const overflowY = window.getComputedStyle(el).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

/** The known scroll root hosting `root`, or null when there is none or it is not scrolling. */
export function resolveScrollRoot(root: Element): HTMLElement | null {
  const scroller = root.parentElement?.closest<HTMLElement>(SCROLL_ROOTS) ?? null;
  return scroller && scrollsVertically(scroller) ? scroller : null;
}

function px(value: string): number {
  return parseFloat(value) || 0;
}

function outerHeight(el: Element): number {
  const style = window.getComputedStyle(el);
  if (style.position === 'absolute' || style.position === 'fixed' || style.display === 'none') return 0;
  return el.getBoundingClientRect().height + px(style.marginTop) + px(style.marginBottom);
}

/**
 * The real content after the Collection inside the scroller: its own
 * margin-bottom, every following sibling up the ancestor chain, and each
 * ancestor's bottom padding + border. Measured from content, not from the
 * scroller's empty fill, so a short page never reads its blank tail as content.
 */
function trailingSpace(root: HTMLElement, scroller: HTMLElement): number {
  let total = px(window.getComputedStyle(root).marginBottom);
  let node: HTMLElement = root;
  while (node !== scroller) {
    for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) total += outerHeight(sib);
    const parent: HTMLElement | null = node.parentElement;
    if (!parent || parent === scroller) break;
    const style = window.getComputedStyle(parent);
    total += px(style.paddingBottom) + px(style.borderBottomWidth);
    node = parent;
  }
  return total;
}

function measure(root: HTMLElement): number | undefined {
  const scroller = resolveScrollRoot(root);
  if (!scroller) return undefined;
  const style = window.getComputedStyle(scroller);
  const padTop = px(style.paddingTop);
  const available = scroller.clientHeight - padTop - px(style.paddingBottom);
  const offset =
    root.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - padTop;
  return Math.round(computeCollectionFitHeight({ available, offset, trailing: trailingSpace(root, scroller) }));
}

/**
 * Watch everything that moves the space left: the scroller, every ancestor of
 * the root up to it, and each ancestor's earlier siblings (content above that
 * grows when data loads). A MutationObserver on the chain re-wires when content
 * is INSERTED above, which no ResizeObserver on the old nodes would see.
 */
function watchLayout(root: HTMLElement, onChange: () => void): () => void {
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange);
  const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
    wire();
    onChange();
  });

  function wire(): void {
    resize?.disconnect();
    mutation?.disconnect();
    const scroller = root.parentElement?.closest<HTMLElement>(SCROLL_ROOTS) ?? null;
    if (!scroller) return;
    resize?.observe(scroller);
    // One observe per target (a second call replaces the options): the scroller
    // watches its children AND the class toggle that turns `.content` into a
    // non-scrolling flex column.
    mutation?.observe(scroller, { childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    let node: HTMLElement = root;
    while (node !== scroller) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) resize?.observe(sib);
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) resize?.observe(sib);
      if (parent !== scroller) {
        mutation?.observe(parent, { childList: true });
        resize?.observe(parent);
      }
      node = parent;
    }
  }

  wire();
  window.addEventListener('resize', onChange);
  return () => {
    resize?.disconnect();
    mutation?.disconnect();
    window.removeEventListener('resize', onChange);
  };
}

export function useCollectionFitHeight(ref: RefObject<HTMLElement | null>): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        // Re-resolve every time: the scroll root can stop scrolling (full-height mode).
        setHeight(measure(root));
      });
    };
    schedule();
    const unwatch = watchLayout(root, schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      unwatch();
    };
  }, [ref]);

  return height;
}
