'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared chrome for the PM visualizers — empty/error/loading states, the
 * "pick a project" notice (project-only views shown in portfolio scope), a
 * status pill, and a section card. Centralised so every visualizer reads the
 * same and we never re-inline these blocks.
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

/** Shown when a project-scoped view (epics/dependencies) is opened in portfolio scope. */
export function PmSelectProject({ what }: { what: string }) {
  return (
    <PmEmpty message={`Select a project to view ${what}. ${capitalize(what)} are scoped to one project.`} />
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

/** A KPI stat card (used by the ROI dashboard). */
export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, margin: '6px 0 2px' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}
