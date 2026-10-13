/**
 * The heatmap's page (PRD 33 §8 S4): the newest kept recording on the route
 * (`heatSnapshot`), its first full snapshot rebuilt in rrweb's sandboxed
 * iframe (`sandbox="allow-same-origin"`, no scripts — `createSnapshotReplayer`)
 * and held still, stretched to the full document height so the `GRID` lattice
 * (laid over the whole document) lines up with it.
 *
 * Everything drawn over the page — heat, areas, a row's highlight — is the
 * render prop's, positioned in PAGE pixels; this box scales the page and its
 * layers together to the available width and scrolls tall pages inside itself.
 * Without a kept recording the layers still draw, on a blank page-shaped box,
 * and the reader is told why.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayDeviceClass } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { createSnapshotReplayer, type ReplayerLike } from '../rrwebLoader';
import styles from './heatmap.module.css';

export interface PageFrame {
  /** The rebuilt page's document (same-origin sandbox), or null without a background. */
  doc: Document | null;
  /** Page size in px. */
  width: number;
  height: number;
}

export interface PageBackgroundProps {
  siteId: string;
  route: string;
  release?: string | null;
  device?: ReplayDeviceClass | null;
  days?: number;
  children: (frame: PageFrame) => ReactNode;
}

type Status = 'loading' | 'ready' | 'none' | 'error';

/** The box drawn when there is no page to rebuild. */
const FALLBACK_PAGE = { width: 1280, height: 1600 } as const;
/** Re-measure once late images and fonts have had a moment to grow the page. */
const SETTLE_MS = [50, 1_200] as const;

function measure(replayer: ReplayerLike): PageFrame | null {
  const iframe = replayer.iframe;
  const doc = iframe?.contentDocument ?? null;
  if (!iframe || !doc) return null;
  const width = Number(iframe.getAttribute('width')) || FALLBACK_PAGE.width;
  const height = Math.max(
    Number(iframe.getAttribute('height')) || 0,
    doc.documentElement?.scrollHeight ?? 0,
    doc.body?.scrollHeight ?? 0,
  ) || FALLBACK_PAGE.height;
  // The whole document in one unscrolled view: element rects are page coordinates.
  iframe.setAttribute('height', String(height));
  iframe.style.height = `${height}px`;
  return { doc, width, height };
}

export function PageBackground({ siteId, route, release = null, device = null, days, children }: PageBackgroundProps) {
  const t = useTranslations('replay.heat');
  const outerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef('');
  titleRef.current = t('frameTitle', { route });
  const [status, setStatus] = useState<Status>('loading');
  const [frame, setFrame] = useState<PageFrame>({ doc: null, ...FALLBACK_PAGE });
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let replayer: ReplayerLike | null = null;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const root = rootRef.current;
    setStatus('loading');
    setFrame({ doc: null, ...FALLBACK_PAGE });

    const settle = () => {
      if (cancelled || !replayer) return;
      const next = measure(replayer);
      if (!next) { setStatus('none'); return; }
      if (replayer.iframe) replayer.iframe.title = titleRef.current;
      setFrame(next);
      setStatus('ready');
    };

    (async () => {
      const snapshot = await replayApi.heatSnapshot(siteId, { route, release, device, days });
      if (cancelled) return;
      if (!snapshot.recordingId) { setStatus('none'); return; }
      const events = await replayApi.getRecordingChunk(siteId, snapshot.recordingId, snapshot.seq);
      if (cancelled || !root) return;
      const created = await createSnapshotReplayer(events, root);
      if (cancelled) { created?.destroy(); return; }
      if (!created) { setStatus('none'); return; }
      replayer = created;
      // rrweb rebuilds the snapshot on its next tick; measure after it, then once more when images settle.
      for (const delay of SETTLE_MS) timers.push(setTimeout(settle, delay));
    })().catch((error: unknown) => {
      void error;
      if (!cancelled) setStatus('error');
    });

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      replayer?.destroy();
      root?.replaceChildren();
    };
  }, [siteId, route, release, device, days]);

  // Fit the page to the box's width (never enlarge).
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setScale(Math.min(1, outer.clientWidth / Math.max(frame.width, 1))));
    observer.observe(outer);
    return () => observer.disconnect();
  }, [frame.width]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
      <div ref={outerRef} className={styles.frame} data-testid="heat-frame">
        <div style={{ position: 'relative', width: frame.width * scale, height: frame.height * scale }}>
          <div className={styles.page} style={{ width: frame.width, height: frame.height, transform: `scale(${scale})` }}>
            <div ref={rootRef} data-testid="heat-page" style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
            {children(frame)}
          </div>
        </div>
      </div>
      {status === 'loading' && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('pageLoading')}</p>}
      {status === 'none' && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('noBackground')}</p>}
      {status === 'error' && <p role="alert" style={{ margin: 0, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{t('pageError')}</p>}
    </div>
  );
}
