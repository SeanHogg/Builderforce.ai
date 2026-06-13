'use client';

import type { CSSProperties, MouseEvent } from 'react';

/**
 * Single source of truth for execution-status → colour, shared by the board
 * cards, the column headers, and the task Agent tab. A status of `undefined`
 * means the chip represents a *configured* agent (no live run), shown neutral.
 */
export const EXECUTION_STATUS_COLOR: Record<string, string> = {
  completed: 'var(--success, #16a34a)',
  failed: 'var(--danger, #dc2626)',
  cancelled: 'var(--text-muted)',
  running: 'var(--coral-bright)',
  submitted: 'var(--coral-bright)',
  pending: 'var(--text-muted)',
  // Agent called ask_human and is waiting on a person — amber "needs attention".
  paused: 'var(--warning, #d97706)',
};

/** Statuses that mean an agent is currently working the task. */
export const ACTIVE_EXECUTION_STATUSES = new Set(['running', 'submitted', 'pending']);

/**
 * Whether a terminal/halted execution can be kicked off again from its chip, and
 * which affordance to show. `retry` re-runs a run that ended unsuccessfully;
 * `resume` continues a halted one. Single source of truth so every surface that
 * renders an execution chip agrees on when the action appears.
 *
 * The `paused` lifecycle is now live (migration 0120): a cloud agent that calls
 * `ask_human` parks its run in `paused` until a human answers its question, so the
 * `resume` affordance is reachable. The primary resume path is answering the
 * question in the human-requests queue; the chip glyph is a secondary nudge.
 */
export type RerunAffordance = 'retry' | 'resume';
export function rerunAffordance(status: string | undefined): RerunAffordance | null {
  if (status === 'failed' || status === 'cancelled') return 'retry';
  if (status === 'paused') return 'resume';
  return null;
}

export interface AgentChipProps {
  /** Primary label — agent role or agentHost name. */
  label: string;
  /** Live execution status; omit for a configured (not-yet-running) agent. */
  status?: string;
  /** Secondary detail, e.g. runtime or model. */
  meta?: string;
  title?: string;
  onClick?: (e: MouseEvent) => void;
}

/**
 * Discrete agent pill: a status dot + role/name (+ optional meta). Rendered one
 * per agent so multiple agents on a lane/task stay individually visible.
 */
export function AgentChip({ label, status, meta, title, onClick }: AgentChipProps) {
  const color = status ? EXECUTION_STATUS_COLOR[status] ?? 'var(--text-muted)' : 'var(--text-muted)';
  const active = status ? ACTIVE_EXECUTION_STATUSES.has(status) : false;

  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    cursor: onClick ? 'pointer' : 'default',
    whiteSpace: 'nowrap',
  };

  return (
    <span
      style={style}
      title={title ?? label}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          ...(active ? { animation: 'agentPulse 1.4s ease-in-out infinite' } : {}),
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {meta && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {meta}</span>}
    </span>
  );
}
