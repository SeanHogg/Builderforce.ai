'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import styles from './Workbench.module.css';

/** Bounds keep the dock useful: never a sliver, never the whole screen. */
const MIN_WIDTH = 300;
const MAX_FRACTION = 0.62;
const DEFAULT_WIDTH = 460;
const STORAGE_KEY = 'bf-workbench-width';

/**
 * The dock — a page opening BESIDE the board instead of replacing it.
 *
 * This is the whole reason the stage is worth keeping mounted: "hold on, let me
 * check the runway" stops being a round trip that costs you the board, the
 * scroll position and (before the live hoist) the call.
 *
 * The dock renders the ROUTE, unchanged. No page component is rewritten to move
 * here — which is the only reason this survives the hundreds of pages the two
 * consolidations are bringing.
 */
export function Workbench({ children, title }: { children: React.ReactNode; title?: string }) {
  const t = useTranslations('workbench');
  const router = useRouter();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLElement>(null);

  // Read the stored width on the client only — rendering the user's width on the
  // server would hydrate a different layout than the one the markup describes.
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(stored) && stored >= MIN_WIDTH) setWidth(stored);
    } catch { /* storage unavailable — the default is a fine dock */ }
  }, []);

  const clamp = useCallback((value: number) => {
    const ceiling = typeof window === 'undefined' ? Infinity : window.innerWidth * MAX_FRACTION;
    return Math.max(MIN_WIDTH, Math.min(value, ceiling));
  }, []);

  const commit = useCallback((value: number) => {
    const next = clamp(value);
    setWidth(next);
    try { localStorage.setItem(STORAGE_KEY, String(Math.round(next))); } catch { /* ignore */ }
  }, [clamp]);

  // Pointer events (not mouse): the same handler drives a trackpad drag and a
  // touch drag, and capture means a fast drag that leaves the handle keeps going.
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    commit(window.innerWidth - event.clientX);
  }, [commit, dragging]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    try { (event.target as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    setDragging(false);
  }, [dragging]);

  // A drag-only resize is unusable without a pointer. Arrow keys give the same
  // control from the keyboard, which is also the only way it is operable by
  // anyone using a screen reader.
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === 'ArrowLeft') { event.preventDefault(); commit(width + step); }
    if (event.key === 'ArrowRight') { event.preventDefault(); commit(width - step); }
  }, [commit, width]);

  // Closing the dock is closing the PAGE — the board is what you go back to.
  const close = useCallback(() => router.push('/create'), [router]);

  return (
    <aside
      ref={frameRef}
      className={styles.dock}
      style={{ ['--workbench-width' as string]: `${Math.round(width)}px` }}
      aria-label={t('region')}
      data-dragging={dragging ? 'true' : 'false'}
    >
      <div
        className={styles.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resize')}
        aria-valuenow={Math.round(width)}
        aria-valuemin={MIN_WIDTH}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />
      <div className={styles.head}>
        <strong className={styles.title}>{title || t('title')}</strong>
        <button type="button" className={styles.close} onClick={close} aria-label={t('close')}>×</button>
      </div>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
