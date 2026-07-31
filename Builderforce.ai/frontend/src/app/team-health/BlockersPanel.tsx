'use client';

/**
 * BlockersPanel — FR-2: Blocker Tracking.
 *
 * Aggregates blocked tasks with age, blocking dependency, owner.
 * Supports escalation assignment inline.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Blocker, HealthScoreConfig } from '@/lib/teamHealthTypes';
import { CollapsibleSection } from './CollapsibleSection';

interface Props {
  blockers: Blocker[];
  config: HealthScoreConfig;
}

export function BlockersPanel({ blockers, config }: Props) {
  const t = useTranslations('teamHealth');

  const urgentCount = useMemo(
    () =>
      blockers.filter((b) => {
        const threshold = b.task.priority === 'urgent' || b.task.priority === 'high'
          ? config.thresholds.blockerAgeThresholds.urgent
          : config.thresholds.blockerAgeThresholds.high;
        return b.ageHours >= threshold;
      }).length,
    [blockers, config],
  );

  const sorted = useMemo(
    () => [...blockers].sort((a, b) => b.ageHours - a.ageHours),
    [blockers],
  );

  return (
    <CollapsibleSection
      title={t('sectionBlockers')}
      badge={blockers.length > 0 ? `${blockers.length}` : undefined}
      badgeTone={urgentCount > 0 ? 'critical' : 'ok'}
    >
      {blockers.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '20px 0' }}>
          {t('noBlockers')}
        </p>
      ) : (
        <>
          {urgentCount > 0 && (
            <p style={{
              margin: '0 0 10px', fontSize: '0.74rem', fontWeight: 600,
              color: 'var(--th-blocker)', padding: '6px 12px',
              background: 'rgba(230,103,103,0.08)', borderRadius: 8,
            }}>
              {t('blockerAlert', { count: urgentCount })}
            </p>
          )}
          <div className="th-table-wrap">
            <table className="th-table">
              <thead>
                <tr>
                  <th>{t('colTask')}</th>
                  <th>{t('colAge')}</th>
                  <th>{t('colBlocking')}</th>
                  <th>{t('colOwner')}</th>
                  <th>{t('colPriority')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b, i) => {
                  const threshold = b.task.priority === 'urgent' || b.task.priority === 'high'
                    ? config.thresholds.blockerAgeThresholds.urgent
                    : config.thresholds.blockerAgeThresholds.high;
                  const overdue = b.ageHours >= threshold;
                  return (
                    <tr
                      key={`${b.task.id}-${i}`}
                      style={{
                        background: overdue ? 'rgba(230,103,103,0.06)' : undefined,
                      }}
                    >
                      <td>
                        <span style={{ fontWeight: 600 }}>#{b.task.id}</span>{' '}
                        {b.task.title}
                      </td>
                      <td>
                        <span
                          style={{
                            fontWeight: 700,
                            color: overdue ? 'var(--th-blocker)' : 'var(--text-primary)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {formatHours(b.ageHours)}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', maxWidth: 240 }}>
                        {b.blocking.what ?? '—'}
                      </td>
                      <td>{b.task.assigneeName ?? t('unassigned')}</td>
                      <td>
                        <PriorityBadge priority={b.task.priority ?? 'medium'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h % 24);
  return rem > 0 ? `${d}d ${rem}h` : `${d}d`;
}

function PriorityBadge({ priority }: { priority: string }) {
  const color =
    priority === 'urgent'
      ? 'var(--th-blocker)'
      : priority === 'high'
        ? 'var(--th-overload)'
        : 'var(--text-muted)';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: '0.68rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        color,
        border: `1px solid ${color}`,
        background: `${color}11`,
      }}
    >
      {priority}
    </span>
  );
}
