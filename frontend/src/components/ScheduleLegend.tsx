'use client';

import { useTranslations } from 'next-intl';
import { DEADLINE_TONE, type DeadlineStatus } from '@/lib/schedule';
import { statusColor } from '@/lib/statusTone';

/**
 * Shared deadline-status legend for the Calendar and Gantt views.
 *
 * Colours come from {@link DEADLINE_TONE} so both views paint a status the
 * same; the LABELS come from the `schedule.status.*` catalog rather than a
 * constant in `lib/schedule.ts`, because a status name is user-facing text and
 * a module-level `Record` cannot be translated.
 */
const ORDER: DeadlineStatus[] = ['overdue', 'soon', 'upcoming'];

export function ScheduleLegend() {
  const t = useTranslations('schedule');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      {ORDER.map((status) => (
        <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-sm)', background: statusColor(DEADLINE_TONE, status, 'solid') }} />
          {t(`status.${status}`)}
        </span>
      ))}
    </div>
  );
}
