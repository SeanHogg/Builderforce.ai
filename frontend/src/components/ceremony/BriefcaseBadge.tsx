'use client';

import type { Task } from '@/lib/builderforceApi';
import { taskStatusBadgeClass, taskStatusLabel } from '@/lib/taskStatus';

/**
 * Assigned-work affordance below a seat: a briefcase with the member's total
 * assigned-ticket count and a tiny per-status dot row. Click opens the full
 * assigned-items panel. Returns null when the member has nothing assigned.
 */
export function BriefcaseBadge({ tasks, onClick }: { tasks: Task[]; onClick?: () => void }) {
  if (tasks.length === 0) return null;
  // Distinct statuses present, for the dot row (capped so it never overflows).
  const statuses = Array.from(new Set(tasks.map((t) => t.status))).slice(0, 5);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${tasks.length} assigned — open work`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} aria-hidden="true">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
      <span>{tasks.length}</span>
      <span style={{ display: 'inline-flex', gap: 2, marginLeft: 2 }}>
        {statuses.map((s) => (
          <span
            key={s}
            className={taskStatusBadgeClass(s)}
            title={taskStatusLabel(s)}
            style={{ width: 6, height: 6, borderRadius: '50%', padding: 0, display: 'inline-block' }}
          />
        ))}
      </span>
    </button>
  );
}
