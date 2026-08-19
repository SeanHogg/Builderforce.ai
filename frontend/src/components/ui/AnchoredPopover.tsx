'use client';

// This module owns hooks and a portal, and the `@/components/ui` barrel is imported by
// server components (e.g. `src/app/product/page.tsx` via `HomePatterns`), so the boundary
// has to be declared here — a consumer cannot be assumed to be client code.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * THE anchored layer: a panel that belongs to a control but must not be painted by the
 * box that control sits in.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * Four surfaces had each hand-rolled the same four things — a portal to `<body>`, a
 * position measured off the trigger's rect, a reflow listener, and an outside-press /
 * Escape dismissal — and they disagreed on all four. The disagreement was not cosmetic:
 * the canvas command bar's team overflow was `position:absolute` INSIDE the bar, and the
 * bar is a `z-index:20` float, so the panel opened upward into the prompt composer
 * (`z-index:21`) and was painted straight over. Pressing `+6` appeared to do nothing,
 * because a stacking context cannot be escaped by raising a z-index inside it.
 *
 * Anything that opens off a trigger and must clear its parent's stacking context or
 * `overflow` uses this. It is a positioning and dismissal primitive only — it draws no
 * chrome, so the caller keeps its own look via `className`.
 *
 * ── WHAT IT DECIDES ──────────────────────────────────────────────────────────────
 *  - `position:fixed` against the viewport, portalled to `<body>` — the only placement
 *    that is immune to an ancestor's `overflow`, `transform` or z-index.
 *  - Flip and clamp are MEASURED, never guessed: the layer's own height decides whether
 *    it fits below, and `maxHeight` is cut to the space that is actually there. The
 *    implementations this replaced carried guesses (`spaceBelow < 240`) that were wrong
 *    for any panel of a different size.
 *  - Nothing paints before it is measured, so a layer never flashes at the wrong corner.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────
 * A modal (`SlideOutPanel`, `ConfirmDialog`) covers the window and is dismissed by its
 * own veil, so it has no anchor to measure. A coach mark (`SectionTour`, `DemoTour`)
 * looks similar and is not: its card, veil and spotlight cutout are ONE dialog root
 * placed around a selector-found element, and pulling the card out of that root to hang
 * it off a ref would separate the highlight from the thing it highlights. Neither is a
 * duplicate of this, and neither should be migrated onto it.
 */

/** Above the modal layer (`9999`–`10001` in globals.css), because a select or a menu
 *  opened INSIDE a dialog must still paint over it. One number, stated once. */
const LAYER_Z = 100000;
/** Kept off the viewport edge, so a clamped layer never looks cropped. */
const VIEWPORT_MARGIN = 8;
/** A layer squeezed below this is not worth flipping into; it scrolls instead. */
const MIN_USABLE_SPACE = 120;

export type AnchoredPlacement = 'below' | 'above' | 'auto';
/** `start`/`end` align the layer's left/right edge to the anchor's; `stretch` also makes
 *  it at least as wide as the anchor, which is what a select's listbox wants. */
export type AnchoredAlign = 'start' | 'end' | 'stretch';

export interface AnchoredPopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  open: boolean;
  /** The control the layer belongs to. Position is measured from it, and a press on it is
   *  never an "outside" press — the trigger owns the toggle. */
  anchorRef: RefObject<HTMLElement | null>;
  /**
   * Close the layer. Wired to an outside press and to Escape. Omit it for a layer whose
   * open state is driven some other way (a hovercard closes on pointer-leave), and
   * neither listener is registered.
   */
  onDismiss?: () => void;
  placement?: AnchoredPlacement;
  align?: AnchoredAlign;
  /** Distance between the anchor's edge and the layer, in px. */
  gap?: number;
  /** Cap the layer's height; the available space caps it further when it has to. */
  maxHeight?: number;
  /** The layer's own node, for callers that reach into it — a menu that moves focus
   *  between its items, a listbox that scrolls the active option into view. */
  layerRef?: MutableRefObject<HTMLDivElement | null>;
  children: ReactNode;
}

interface LayerBox {
  top: number;
  left: number;
  maxHeight: number;
  minWidth?: number;
}

export function AnchoredPopover({
  open,
  anchorRef,
  onDismiss,
  placement = 'below',
  align = 'start',
  gap = 6,
  maxHeight,
  layerRef: exposedRef,
  className,
  style,
  children,
  ...rest
}: AnchoredPopoverProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  /** One ref internally, published to the caller's if it wants one — rather than a
   *  forwardRef that would take the node away from the positioning that needs it. */
  const holdNode = useCallback((node: HTMLDivElement | null) => {
    layerRef.current = node;
    if (exposedRef) exposedRef.current = node;
  }, [exposedRef]);
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<LayerBox | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    // The layer's own size, read while it is laid out but before it is placed — which is
    // why it renders hidden for one frame rather than at a guessed height.
    const layerWidth = layer.offsetWidth;
    const layerHeight = layer.offsetHeight;

    const spaceBelow = viewportHeight - rect.bottom - gap - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - gap - VIEWPORT_MARGIN;
    const wantsFlip = layerHeight > spaceBelow && spaceAbove > spaceBelow;
    const resolved = placement === 'auto' ? (wantsFlip ? 'above' : 'below') : placement;
    const room = Math.max(MIN_USABLE_SPACE, resolved === 'above' ? spaceAbove : spaceBelow);
    const height = Math.min(layerHeight || room, room, maxHeight ?? Infinity);

    const top = resolved === 'above'
      ? Math.max(VIEWPORT_MARGIN, rect.top - gap - height)
      : Math.min(rect.bottom + gap, Math.max(VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - height));
    const width = align === 'stretch' ? Math.max(layerWidth, rect.width) : layerWidth;
    const rawLeft = align === 'end' ? rect.right - width : rect.left;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, viewportWidth - width - VIEWPORT_MARGIN));

    setBox({
      top,
      left,
      maxHeight: Math.min(room, maxHeight ?? Infinity),
      ...(align === 'stretch' ? { minWidth: rect.width } : {}),
    });
  }, [align, anchorRef, gap, maxHeight, placement]);

  // Before paint, so the first frame the user sees is already in the right corner.
  useLayoutEffect(() => {
    if (!open || !mounted) { setBox(null); return; }
    measure();
  }, [open, mounted, measure]);

  // Stay glued to the anchor: scrolling any ancestor (capture phase), resizing the window,
  // and the layer's OWN content changing size all move it.
  useEffect(() => {
    if (!open || !mounted) return;
    const reflow = () => measure();
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reflow);
    if (observer && layerRef.current) observer.observe(layerRef.current);
    return () => {
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
      observer?.disconnect();
    };
  }, [open, mounted, measure]);

  // Dismissal, only when the caller owns a close. `mousedown` rather than `click` so the
  // layer is gone before the press lands on whatever is underneath.
  useEffect(() => {
    if (!open || !onDismiss) return;
    const outside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (layerRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onDismiss();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onDismiss, anchorRef]);

  if (!open || !mounted || typeof document === 'undefined') return null;

  const layerStyle: CSSProperties = {
    position: 'fixed',
    top: box?.top ?? 0,
    left: box?.left ?? 0,
    zIndex: LAYER_Z,
    maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
    ...(box ? { maxHeight: box.maxHeight, overflowY: 'auto' as const } : {}),
    ...(box?.minWidth ? { minWidth: box.minWidth } : {}),
    // Laid out but not shown until measured — one frame, no flash at the wrong corner.
    ...(box ? {} : { visibility: 'hidden' as const }),
    ...style,
  };

  return createPortal(
    <div ref={holdNode} className={className} style={layerStyle} {...rest}>{children}</div>,
    document.body,
  );
}
