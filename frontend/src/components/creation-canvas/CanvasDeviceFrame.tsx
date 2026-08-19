/*
 * No `'use client'` here on purpose. Every importer — the app surface, the site surface,
 * the website card and the live web page panel — is already inside `CreationCanvas.tsx`'s
 * client boundary, and `check-frontend-architecture` counts directives, not components.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { observeResizeOnAnimationFrame } from '@/lib/observeResize';
import { CANVAS_VIEWPORT_WIDTHS, type CanvasViewport } from '@/lib/canvasViewport';
import styles from './CreationCanvas.module.css';

/**
 * THE framed document — one document, laid out at a real device width, scaled into
 * whatever room the canvas has for it.
 *
 * ── THE DEFECT THIS ENDS ─────────────────────────────────────────────────────────
 * Three surfaces framed a document and only one of them did it correctly. The live web
 * page panel measured its wrapper and scaled a device-width frame into it; the `app`
 * surface set `width:min(100%,var(--app-width))` on a frame that also carried `flex:1` in
 * a row — so `flex-basis:0%` won, the frame filled the stage at every setting, and
 * Desktop/Tablet/Phone were three buttons that changed nothing you could see; the `site`
 * surface capped its width honestly but still handed the document the SMALLER width, so
 * the "Desktop" reading rendered the mobile collapse of the very page being checked.
 *
 * A width cap and a device width are not the same tool. Capping asks the document to be
 * narrow. This lays the document out at exactly `CANVAS_VIEWPORT_WIDTHS[viewport]` and
 * transforms the result, so the page inside sees the width the reader picked and the
 * three readings differ the way they differ on three real machines.
 *
 * ── WHY THE ISOLATION IS THE POINT AND NOT A DETAIL ──────────────────────────────
 * A document rendered as React inside the board inherits the board: its tokens, its
 * fonts, its `var(--surface)`, and its light/dark theme. That is not a preview of the
 * artifact, it is a preview of the artifact wearing the app's clothes — a landing page
 * that turns dark because the operator toggled the canvas, drawn at the 6px type a
 * thumbnail approximation needs. A frame has its own document and its own cascade, so
 * nothing outside it can reach in. Every consumer therefore passes a COMPLETE document
 * and none of them pass a class name that could style its insides.
 *
 * The sandbox stays the caller's decision, because the answers genuinely differ: a
 * generated document runs with no origin at all, while a real site on the open web needs
 * its own origin to render. Both are declared where that reasoning lives, and each is
 * asserted by a test on its own module.
 */
export interface CanvasDeviceFrameProps {
  /** The frame's accessible name — always the thing being previewed, never "preview". */
  title: string;
  viewport: CanvasViewport;
  /** A complete document to render with no origin. Mutually exclusive with `src`. */
  srcDoc?: string;
  /** A live address to load. Mutually exclusive with `srcDoc`. */
  src?: string;
  sandbox: string;
  allow?: string;
  referrerPolicy?: 'no-referrer';
  loading?: 'lazy';
  /** Remount token: what "reload" and "restart" mean for a document with no server. */
  reloadKey?: string | number;
  onLoad?: () => void;
  /** Board classes (`nodrag nowheel`) so a scroll inside the frame is not a canvas pan. */
  frameClassName?: string;
  className?: string;
  /**
   * The frame element itself, for a caller that must tell ITS document's messages from
   * every other framed document on the same board. Two website cards both listening on
   * `window` would otherwise each act on the other's page switch.
   */
  frameRef?: RefObject<HTMLIFrameElement | null>;
  /** Overlays positioned against the wrapper — a loading note, a status strip. */
  children?: ReactNode;
}

export function CanvasDeviceFrame({
  title, viewport, srcDoc, src, sandbox, allow, referrerPolicy, loading,
  reloadKey, onLoad, frameClassName, className, frameRef, children,
}: CanvasDeviceFrameProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const width = CANVAS_VIEWPORT_WIDTHS[viewport];

  // Fit the device-width frame into whatever width the surface, panel or card has.
  // A zero measurement (a wrapper that has not been laid out, or jsdom, which has no
  // `ResizeObserver` at all) must fall back to 1 rather than to a scale of 0 — the frame
  // height is `100 / scale`, so a zero would resolve to an infinite height.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') { setScale(1); return; }
    const measure = () => setScale(Math.min(1, wrap.clientWidth / width) || 1);
    const stop = observeResizeOnAnimationFrame(wrap, measure);
    measure();
    return stop;
  }, [width]);

  return (
    <div ref={wrapRef} className={`${styles.deviceFrameWrap} ${className ?? ''}`} data-viewport={viewport}>
      <iframe
        key={reloadKey}
        ref={frameRef ?? null}
        className={`${styles.deviceFrame} ${frameClassName ?? ''}`}
        title={title}
        sandbox={sandbox}
        style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})` }}
        {...(srcDoc === undefined ? {} : { srcDoc })}
        {...(src === undefined ? {} : { src })}
        {...(allow === undefined ? {} : { allow })}
        {...(referrerPolicy === undefined ? {} : { referrerPolicy })}
        {...(loading === undefined ? {} : { loading })}
        {...(onLoad === undefined ? {} : { onLoad })}
      />
      {children}
    </div>
  );
}
