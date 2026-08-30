/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`,
 * which already declares the boundary, so a directive would mark a second entry point
 * that does not exist — the same reason `CanvasAppSurface` and `CanvasSiteSurface`
 * state in their own headers.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DaysWindowSelect } from '@/components/insights/LensShell';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { ReorderableWidgetGrid } from '@/components/widgets/ReorderableWidgetGrid';
import { usePins } from '@/lib/widgets/PinsProvider';
import { useCanvasSurfaceActions } from './canvasSurfaceActions';
import styles from './CreationCanvas.module.css';

/** The Ask-a-question card is a registered widget, same as `/insights` shows it —
 *  one guaranteed tile so this surface is never empty before anyone has pinned
 *  anything of their own. */
const ASK_IDS = ['overview.ask'];

/**
 * What this session is worth, read back — the "Measure" reading of the canvas.
 *
 * ── WHY THIS REUSES `WidgetCard`/`ReorderableWidgetGrid` RATHER THAN A NEW CHART ────
 * The product already has ONE dashboard vocabulary (`/insights`, every Insights tab,
 * every custom dashboard) built from a shared widget registry, `WidgetCard`'s frame
 * and `PinsProvider`'s pins — reinventing a second metrics surface here would be
 * exactly the drift `check-destinations` exists to stop one layer up. This shows the
 * SAME pinned widgets `/insights`'s "My Dashboard" view shows, because `PinsProvider`
 * is already mounted app-wide (`ConditionalAppShell.tsx`) and reaches in here for
 * free — pin a card anywhere in the product and it appears on the canvas too.
 *
 * ── WHY NOT A SESSION-SCOPED METRICS SET ─────────────────────────────────────────
 * There is no per-canvas metrics concept in this product yet (no `session_id` on a
 * widget or a metric) — building one would be new backend surface for a chrome
 * redesign to lean on. What already exists and is real is the READER's own pinned
 * view; this surface is that view, reachable without leaving the board.
 */
export interface CanvasInsightsSurfaceProps {
  /** Escape hands the board back. No exit BUTTON, same as `CanvasAppSurface`: this
   *  surface is in the rail, so pressing Insights again is the way out. */
  onExit: () => void;
}

export function CanvasInsightsSurface({ onExit }: CanvasInsightsSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.insights');
  const ti = useTranslations('insights');
  const { pinned, loading } = usePins();

  // A days-window control, same shape as the App surface's Run/Stop — published INTO
  // the one session bar rather than a second toolbar of this surface's own. Local
  // state, not `readCanvasSurface`-style persistence: the window is a reading choice
  // like `/insights`'s own (`useState(30)`), not a place someone worked — it resets
  // to 30 days each visit rather than remembering a stale filter.
  const [days, setDays] = useState(30);
  useCanvasSurfaceActions(() => ({
    controls: (
      <DaysWindowSelect value={days} onChange={setDays} />
    ),
  }), [days, setDays]);

  return (
    <section
      className={styles.insightsSurface}
      data-testid="canvas-insights-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.insightsSurfaceBody}>
        <WidgetGrid ids={ASK_IDS} days={days} />
        {pinned.length === 0 ? (
          <div className={styles.insightsEmpty} role="status">
            {loading ? (
              <strong>{ti('loading')}</strong>
            ) : (
              <>
                <strong>{ti('home.emptyTitle')}</strong>
                <p>{ti('home.emptyBody')}</p>
                <Link href="/insights">{t('openFull')}</Link>
              </>
            )}
          </div>
        ) : (
          <>
            <ReorderableWidgetGrid ids={pinned} days={days} />
            <Link href="/insights" className={styles.insightsFullLink}>{t('openFull')}</Link>
          </>
        )}
      </div>
    </section>
  );
}
