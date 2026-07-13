'use client';

import type { CSSProperties, ReactNode } from 'react';
import { InsightStat } from '@/components/dashboard/InsightStat';

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
  borderRadius: 12,
  color: 'var(--text-secondary)',
  fontSize: '0.9rem',
};

export function PmEmpty({ message }: { message: string }) {
  return <div style={noticeStyle}>{message}</div>;
}

export function PmError({ message }: { message: string }) {
  return <div style={{ ...noticeStyle, color: 'var(--danger, #dc2626)' }}>{message}</div>;
}

/** A titled section card matching the dashboard surfaces. */
export function PmCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  done: '#16a34a',
  shipped: '#16a34a',
  in_progress: '#2563eb',
  in_review: '#7c3aed',
  blocked: '#dc2626',
  planned: '#6b7280',
  now: '#16a34a',
  next: '#2563eb',
  later: '#6b7280',
};

/** A small colored status/horizon pill. */
export function StatusPill({ value }: { value: string }) {
  const color = STATUS_COLORS[value] ?? '#6b7280';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: '0.72rem',
        fontWeight: 600,
        color: '#fff',
        background: color,
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
  const color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden' }}>
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
