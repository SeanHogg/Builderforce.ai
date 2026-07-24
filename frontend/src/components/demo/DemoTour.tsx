'use client';

/**
 * DemoTour (migration 0360) — a persona-aware product tour that runs once a demo
 * visitor is signed into the live app. It walks them through the key features by
 * navigating to each surface and spotlighting the matching nav item (the only
 * always-present, stable anchor), with a positioned coach-mark card. Welcome and
 * finish steps are centered cards; the finish CTA hands off to the existing
 * conversion prompt.
 *
 * Resilient by design: each step polls for its `[data-tour]` anchor and falls
 * back to a centered card if the element isn't on screen (e.g. a nav item hidden
 * on mobile), so a missing anchor never breaks the walk. Mounted by
 * DemoModeProvider, which owns the open/close state and suppresses the auto
 * convert/exit prompts while the tour is open.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { trackDemoEvent, type DemoPersona } from '@/lib/demoApi';
import { buildTourSteps, TOUR_ROUTES, TOUR_SECTION, type TourAnchor, type TourStep } from './demoTourSteps';

interface DemoTourProps {
  persona: DemoPersona;
  open: boolean;
  /** Close the tour (skip or finish). `completed` distinguishes the two for telemetry. */
  onClose: (completed: boolean) => void;
  /** Finish CTA — hand off to the existing convert prompt. */
  onRequestConvert: () => void;
}

interface Rect { top: number; left: number; width: number; height: number; }

const CARD_W = 360;
const CARD_MARGIN = 14;
const POLL_MS = 1600;

/** Find the first VISIBLE element for a data-tour id. */
function findByTour(id: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`));
  return els.find((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0) ?? null;
}

/** Resolve a step's spotlight target: the on-page feature SECTION first, then the
 *  nav item, so the ring lands on real content whenever it's present. */
function findTarget(anchor: TourAnchor): HTMLElement | null {
  return findByTour(TOUR_SECTION[anchor]) ?? findByTour(anchor);
}

/** Pad a target rect and clamp it inside the viewport so the ring stays on screen. */
function clampToViewport(r: Rect): Rect {
  const pad = 6;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const top = Math.max(8, r.top - pad);
  const left = Math.max(8, r.left - pad);
  const right = Math.min(vw - 8, r.left + r.width + pad);
  const bottom = Math.min(vh - 8, r.top + r.height + pad);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Placement of the coach-mark card relative to the spotlight rect (null = centered). */
function placeCard(rect: Rect | null): { top: number; left: number; centered: boolean } {
  if (typeof window === 'undefined' || !rect) {
    return { top: 0, left: 0, centered: true };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardH = 210; // estimate; card clamps within viewport regardless
  // Prefer right of the target (sidebar nav sits on the left), then below, then above, else center.
  if (vw - (rect.left + rect.width) > CARD_W + CARD_MARGIN * 2) {
    const top = Math.min(Math.max(CARD_MARGIN, rect.top), vh - cardH - CARD_MARGIN);
    return { top, left: rect.left + rect.width + CARD_MARGIN, centered: false };
  }
  if (vh - (rect.top + rect.height) > cardH + CARD_MARGIN) {
    const left = Math.min(Math.max(CARD_MARGIN, rect.left), vw - CARD_W - CARD_MARGIN);
    return { top: rect.top + rect.height + CARD_MARGIN, left, centered: false };
  }
  if (rect.top > cardH + CARD_MARGIN) {
    const left = Math.min(Math.max(CARD_MARGIN, rect.left), vw - CARD_W - CARD_MARGIN);
    return { top: rect.top - cardH - CARD_MARGIN, left, centered: false };
  }
  return { top: 0, left: 0, centered: true };
}

export function DemoTour({ persona, open, onClose, onRequestConvert }: DemoTourProps) {
  const t = useTranslations('demo.tour');
  const router = useRouter();
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const steps = useRef<TourStep[]>(buildTourSteps(persona));
  const pollRef = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);
  // Rebuild + reset whenever the tour (re)opens.
  useEffect(() => {
    if (open) {
      steps.current = buildTourSteps(persona);
      setIndex(0);
      trackDemoEvent({ kind: 'tour_started', persona, path: pathname });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, persona]);

  const step = steps.current[index];

  const clearPoll = () => {
    if (pollRef.current != null) { cancelAnimationFrame(pollRef.current); pollRef.current = null; }
  };

  const measure = useCallback((anchor: TourAnchor, scroll = false) => {
    const el = findTarget(anchor);
    if (!el) return false;
    if (scroll) {
      const r0 = el.getBoundingClientRect();
      // Only scroll when the target is substantially off-screen (avoid a jump when it's already visible).
      if (r0.top < 0 || r0.bottom > window.innerHeight) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    return true;
  }, []);

  // On each step: navigate if needed, then poll for the anchor (centered fallback).
  useEffect(() => {
    if (!open || !step) return;
    clearPoll();
    if (step.kind !== 'anchor') { setRect(null); return; }

    const route = TOUR_ROUTES[step.anchor];
    // Compare pathname only (ignore query) so /projects?tab=… doesn't loop-navigate.
    if (pathname !== route) router.push(route);

    const started = performance.now();
    const tick = () => {
      if (measure(step.anchor, true)) { pollRef.current = null; return; }
      if (performance.now() - started < POLL_MS) {
        pollRef.current = requestAnimationFrame(tick);
      } else {
        setRect(null); // give up → centered card
        pollRef.current = null;
      }
    };
    pollRef.current = requestAnimationFrame(tick);
    return clearPoll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  // Keep the spotlight glued to the anchor on scroll/resize.
  useLayoutEffect(() => {
    if (!open || step?.kind !== 'anchor') return;
    const onMove = () => measure(step.anchor);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  const total = steps.current.length;

  const finish = useCallback((completed: boolean) => {
    clearPoll();
    trackDemoEvent({ kind: completed ? 'tour_completed' : 'tour_skipped', persona, path: pathname, metadata: { step: index } });
    onClose(completed);
  }, [index, onClose, persona, pathname]);

  const next = useCallback(() => {
    if (index >= total - 1) { finish(true); return; }
    const ni = index + 1;
    setIndex(ni);
    trackDemoEvent({ kind: 'tour_step', persona, path: pathname, metadata: { step: ni } });
  }, [index, total, finish, persona, pathname]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Esc skips.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!mounted || !open || !step) return null;

  const isAnchor = step.kind === 'anchor';
  // Clamp the spotlight to the viewport so the ring stays fully on screen even
  // when the target section is taller/wider than the viewport (already padded).
  const spot: Rect | null = isAnchor && rect ? clampToViewport(rect) : null;
  const place = placeCard(spot);
  const centered = place.centered;

  const title = step.kind === 'welcome' ? t('welcomeTitle')
    : step.kind === 'finish' ? t('finishTitle')
    : t(`nav.${step.anchor}.title`);
  const body = step.kind === 'welcome' ? t(`welcome.${persona}`)
    : step.kind === 'finish' ? t('finishBody')
    : t(`nav.${step.anchor}.body`);

  const cardStyle: React.CSSProperties = centered
    ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    : { top: place.top, left: place.left };

  return createPortal(
    <div className="demo-tour" role="dialog" aria-modal="true" aria-label={t('ariaLabel')}>
      {/* Click blocker (transparent for anchor steps; the hole's shadow dims). */}
      <div className={`demo-tour-blocker${spot ? '' : ' dim'}`} />

      {/* Spotlight hole (anchor steps with a found target). */}
      {spot && (
        <div
          className="demo-tour-hole"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      )}

      <div className="demo-tour-card" style={cardStyle}>
        <div className="demo-tour-progress">{t('stepOf', { current: index + 1, total })}</div>
        <h3 className="demo-tour-title">{title}</h3>
        <p className="demo-tour-body">{body}</p>
        <div className="demo-tour-actions">
          <button type="button" className="demo-tour-skip" onClick={() => finish(false)}>
            {step.kind === 'finish' ? t('close') : t('skip')}
          </button>
          <div className="demo-tour-nav">
            {index > 0 && step.kind !== 'finish' && (
              <button type="button" className="demo-tour-btn ghost" onClick={back}>{t('back')}</button>
            )}
            {step.kind === 'finish' ? (
              <button type="button" className="demo-tour-btn primary" onClick={() => { onRequestConvert(); finish(true); }}>
                {t('getStarted')}
              </button>
            ) : (
              <button type="button" className="demo-tour-btn primary" onClick={next}>
                {index === total - 2 ? t('finish') : t('next')}
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>,
    document.body,
  );
}

const styles = `
  .demo-tour-blocker { position: fixed; inset: 0; z-index: 9990; pointer-events: auto; background: transparent; }
  .demo-tour-blocker.dim { background: rgba(3, 7, 18, 0.66); }
  .demo-tour-hole {
    position: fixed; z-index: 9990; pointer-events: none; border-radius: 12px;
    box-shadow: 0 0 0 9999px rgba(3, 7, 18, 0.66);
    outline: 2px solid var(--accent, #4d9eff); outline-offset: 2px;
    transition: top .18s ease, left .18s ease, width .18s ease, height .18s ease;
  }
  .demo-tour-card {
    position: fixed; z-index: 9991; width: min(360px, 92vw); box-sizing: border-box;
    padding: 18px; border-radius: 16px;
    background: var(--surface-card-strong, rgba(10,15,26,0.96));
    border: 1px solid var(--border, rgba(255,255,255,0.14));
    box-shadow: 0 16px 48px rgba(0,0,0,0.45); backdrop-filter: blur(8px);
    pointer-events: auto;
  }
  .demo-tour-progress {
    font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--cyan-bright, #00e5cc); margin-bottom: 8px;
  }
  .demo-tour-title { margin: 0 0 8px; font-size: 17px; font-weight: 700; color: var(--text-primary, #f0f4ff); }
  .demo-tour-body { margin: 0 0 16px; font-size: 14px; line-height: 1.55; color: var(--text-secondary, #aab3c5); }
  .demo-tour-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .demo-tour-nav { display: flex; align-items: center; gap: 8px; }
  .demo-tour-skip {
    background: none; border: none; cursor: pointer; font-family: inherit; font-size: 13px;
    color: var(--text-muted, #7c869c); padding: 6px 4px;
  }
  .demo-tour-skip:hover { color: var(--text-primary, #f0f4ff); }
  .demo-tour-btn {
    font-family: inherit; font-size: 13.5px; font-weight: 700; border-radius: 9px; cursor: pointer;
    padding: 8px 14px; border: 1px solid transparent;
  }
  .demo-tour-btn.primary { background: var(--accent, #4d9eff); color: #fff; }
  .demo-tour-btn.ghost { background: transparent; color: var(--text-primary, #f0f4ff); border-color: var(--border, rgba(255,255,255,0.2)); }
  @media (max-width: 520px) {
    .demo-tour-card { left: 50% !important; transform: translateX(-50%); width: 92vw;
      top: auto !important; bottom: calc(72px + env(safe-area-inset-bottom)); }
  }
`;
