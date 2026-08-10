'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import styles from './HomeScroller.module.css';

/**
 * A horizontal rail for a set the reader BROWSES rather than reads.
 *
 * Some homepage sections are an argument and belong in a grid you take in at
 * once. A catalogue is not: "everything you can bring onto the canvas" is a
 * breadth claim, and rendering nine dense paragraphs as a four-column wall makes
 * the page stall exactly where it should be gathering momentum. A rail shows a
 * few, clips the next at the edge so the reader knows there is more, and moves
 * at their pace.
 *
 * Built on native scroll-snap, so swipe and trackpad work with no JS and the
 * rail is usable before hydration; the arrows and progress bar are enhancements.
 * They disable at each end rather than wrapping — a rail that silently jumps
 * back to the start loses the reader's place.
 *
 * The state lives in {@link useHomeScroller} rather than inside the rail so a
 * section can put the controls beside its HEADING. Arrows overlaid on the cards
 * cover content on exactly the narrow screens where the cards are already tight.
 */

export interface HomeScrollerState {
  railRef: RefObject<HTMLDivElement>;
  atStart: boolean;
  atEnd: boolean;
  /** 0–1 through the rail's travel; 1 when there is nothing to scroll. */
  progress: number;
  page: (direction: 1 | -1) => void;
}

export function useHomeScroller(): HomeScrollerState {
  // `useRef<T>(null)` (not `<T | null>`) so the result is a RefObject the JSX
  // `ref` prop accepts; `.current` stays nullable at the read sites.
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [progress, setProgress] = useState(1);

  const sync = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const travel = rail.scrollWidth - rail.clientWidth;
    setAtStart(rail.scrollLeft <= 1);
    // A pixel of slack: sub-pixel layout means scrollLeft rarely lands exactly
    // on the maximum, which would leave the "next" arrow enabled forever.
    setAtEnd(travel - rail.scrollLeft <= 1);
    setProgress(travel > 0 ? Math.min(1, Math.max(0, rail.scrollLeft / travel)) : 1);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    sync();
    rail.addEventListener('scroll', sync, { passive: true });
    // Cards reflow on resize and on font load, which changes both ends.
    const observer = new ResizeObserver(sync);
    observer.observe(rail);
    return () => {
      rail.removeEventListener('scroll', sync);
      observer.disconnect();
    };
  }, [sync]);

  const page = useCallback((direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    // One viewport of cards minus a sliver, so the card that was clipped at the
    // edge becomes the first fully visible one.
    const step = Math.max(240, rail.clientWidth * 0.8);
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollBy({ left: step * direction, behavior: reduced ? 'auto' : 'smooth' });
  }, []);

  return { railRef, atStart, atEnd, progress, page };
}

export function HomeScrollerRail({ scroller, children, label }: {
  scroller: HomeScrollerState;
  children: ReactNode;
  label: string;
}) {
  return (
    <>
      <div className={styles.wrap}>
        {/* Focusable so keyboard users can arrow along the rail; each card's own
            links stay in the tab order regardless. */}
        <div ref={scroller.railRef} className={styles.rail} role="group" aria-label={label} tabIndex={0}>
          {children}
        </div>
      </div>
      <div className={styles.progress} aria-hidden="true">
        <div className={styles.progressBar} style={{ width: `${Math.round(scroller.progress * 100)}%` }} />
      </div>
    </>
  );
}

/** One card slot on the rail. */
export function HomeScrollerItem({ children }: { children: ReactNode }) {
  return <div className={styles.item}>{children}</div>;
}

/** Prev/next controls — place these next to the section heading. */
export function HomeScrollerControls({ scroller }: { scroller: HomeScrollerState }) {
  const t = useTranslations('homeScroller');
  return (
    <div className={styles.controls}>
      <button type="button" className={styles.arrowButton} onClick={() => scroller.page(-1)} disabled={scroller.atStart} aria-label={t('previous')}>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" className={styles.arrowButton} onClick={() => scroller.page(1)} disabled={scroller.atEnd} aria-label={t('next')}>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}
