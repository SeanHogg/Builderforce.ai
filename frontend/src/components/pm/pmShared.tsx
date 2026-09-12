'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { statusPillStyle, type StatusToneMap } from '@/lib/statusTone';

/**
 * Shared chrome for the PM visualizers — empty/error/loading states, a status
 * pill, and a section card. Centralised so every visualizer reads the same and
 * we never re-inline these blocks.
 */

const noticeStyle: CSSProperties = {
  padding: 32,
  textAlign: 'center',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  color: 'var(--text-secondary)',
  fontSize: '0.9rem',
};

export function PmEmpty({ message }: { message: string }) {
  return <div style={noticeStyle}>{message}</div>;
}

export function PmError({ message }: { message: string }) {
  return <div style={{ ...noticeStyle, color: 'var(--danger)' }}>{message}</div>;
}

/** A titled section card matching the dashboard surfaces. */
export function PmCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * A card the URL can point AT.
 *
 * A deep-link that only selects the right TAB has not opened anything — the user still
 * has to find the card among dozens. This wrapper gives one item a stable DOM id, rings
 * it, and scrolls it into view when the link names it, so "Open" on a chat-created OKR
 * lands on that OKR.
 *
 * The ring is a token-coloured `outline` (not a border) so it never reflows the card in
 * either theme, and `scrollMarginTop` keeps the ringed card clear of the sticky app
 * header. Motion respects the user's reduced-motion preference.
 */
export function FocusTarget({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [active]);
  return (
    <div
      id={id}
      ref={ref}
      style={{
        scrollMarginTop: 80,
        ...(active
          ? {
              outline: '2px solid var(--accent)',
              outlineOffset: 4,
              borderRadius: 'var(--radius-lg)',
            }
          : null),
      }}
    >
      {children}
    </div>
  );
}

/** The PM work-item status + roadmap-horizon vocabulary. */
export type WorkItemStatus =
  | 'done' | 'shipped' | 'in_progress' | 'in_review' | 'blocked' | 'backlog' | 'planned'
  | 'now' | 'next' | 'later';

/**
 * THE work-item status → tone map, shared by this pill and the dependency graph's
 * node strokes so a task status reads the same on every PM surface. `in_review` is
 * `accent` (not `info`) so it stays distinct from `in_progress` beside it.
 */
export const WORK_ITEM_STATUS_TONE: StatusToneMap<WorkItemStatus> = {
  done: 'success',
  shipped: 'success',
  in_progress: 'info',
  in_review: 'accent',
  blocked: 'danger',
  backlog: 'neutral',
  planned: 'neutral',
  now: 'success',
  next: 'info',
  later: 'neutral',
};

/** A small colored status/horizon pill. */
export function StatusPill({ value }: { value: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 'var(--radius-full)',
        borderWidth: 1,
        borderStyle: 'solid',
        fontSize: '0.72rem',
        fontWeight: 600,
        ...statusPillStyle(WORK_ITEM_STATUS_TONE, value),
        whiteSpace: 'nowrap',
      }}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * A horizontal progress bar for a [0,1] fraction (OKR key results, initiative
 * roll-up). Colour bands match the KR health convention (red→amber→green).
 */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  const color = pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--error)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 'var(--radius-full)', background: 'var(--border-subtle)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right' }}>
        {label ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

/** A KPI stat card (used by the ROI dashboard). `chart` renders an optional
 *  trailing visual (e.g. a <Sparkline/>) beneath the sub-label. */
/**
 * Thin alias of the canonical {@link InsightStat} Dashboard-library widget — kept
 * so the many PM/insights call sites needn't change while the implementation
 * stays single-sourced (no divergent StatCard). New surfaces should import
 * `InsightStat` directly to access trends/deltas/recency/nudges.
 */
export function StatCard({ label, value, sub, chart }: { label: string; value: string; sub?: string; chart?: ReactNode }) {
  return <InsightStat label={label} value={value} sub={sub} chart={chart} />;
}
