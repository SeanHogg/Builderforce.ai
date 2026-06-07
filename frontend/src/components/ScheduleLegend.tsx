'use client';

import { DEADLINE_COLORS, DEADLINE_LABELS, type DeadlineStatus } from '@/lib/schedule';

/**
 * Shared deadline-status legend for the Calendar and Gantt views, so both read
 * from the same color/label source ({@link DEADLINE_COLORS}/{@link DEADLINE_LABELS}).
 */
const ORDER: DeadlineStatus[] = ['overdue', 'soon', 'upcoming'];

export function ScheduleLegend() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      {ORDER.map((status) => (
        <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: DEADLINE_COLORS[status] }} />
          {DEADLINE_LABELS[status]}
        </span>
      ))}
    </div>
  );
}
