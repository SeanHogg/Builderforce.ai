'use client';

/**
 * AgingWipPanel — FR-3: Aging WIP.
 *
 * Lists in-progress tasks older than the configured threshold, sorted by
 * staleness, with yellow/orange/red colour coding. Supports "intentionally
 * paused" marking and CSV export.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgingWip, HealthScoreConfig } from '@/lib/teamHealthTypes';
import { agingWipToCsv } from '@/lib/teamHealthUtils';
import { CollapsibleSection } from './CollapsibleSection';

interface Props {
  items: AgingWip[];
  config: HealthScoreConfig;
}

export function AgingWipPanel({ items, config }: Props) {
  const t = useTranslations('teamHealth');
  const [pausedIds, setPausedIds] = useState<Set<number>>(new Set());
  const [showPauseInput, setShowPauseInput] = useState<number | null>(null);
  const [pauseNote, setPauseNote] = useState('');
  const [snoozeDays, setSnoozeDays] = useState(7);

  const visible = useMemo(
    () => items.filter((a) => !pausedIds.has(a.task.id)),
    [items, pausedIds],
  );

  const markPaused = useCallback(
    (taskId: number) => {
      setPausedIds((prev) => new Set(prev).add(taskId));
      setShowPauseInput(null);
      setPauseNote('');
    },
    [],
  );

  const exportCsv = useCallback(() => {
    const csv = agingWipToCsv(visible);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aging-wip-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [visible]);

  const criticalCount = visible.filter((a) => a.ageInThresholds >= 3).length;

  return (
    <CollapsibleSection
      title={t('sectionAgingWip')}
      badge={visible.length > 0 ? `${visible.length}` : undefined}
      badgeTone={criticalCount > 0 ? 'critical' : visible.length > 0 ? 'warning' : 'ok'}
      actions={
        visible.length > 0 ? (
          <button type="button" className="th-action-btn" onClick={exportCsv}>
            {t('exportCsv')}
          </button>
        ) : undefined
      }
    >
      {visible.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '20px 0' }}>
          {t('noAgingWip')}
        </p>
      ) : (
        <div className="th-table-wrap">
          <table className="th-table">
            <thead>
              <tr>
                <th>{t('colTask')}</th>
                <th>{t('colAssignee')}</th>
                <th>{t('colStatus')}</th>
                <th>{t('colStale')}</th>
                <th>{t('colSeverity')}</th>
                <th>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const severityClass =
                  a.ageInThresholds >= 3 ? 'th-aging-red' : a.ageInThresholds >= 2 ? 'th-aging-orange' : 'th-aging-yellow';
                const severityLabel =
                  a.ageInThresholds >= 3 ? t('severityRed') : a.ageInThresholds >= 2 ? t('severityOrange') : t('severityYellow');
                const severityColor =
                  a.ageInThresholds >= 3 ? 'var(--th-blocker)' : a.ageInThresholds >= 2 ? 'var(--th-overload)' : 'var(--th-aging)';

                return (
                  <tr key={a.task.id} className={severityClass}>
                    <td>
                      <span style={{ fontWeight: 600 }}>#{a.task.id}</span>{' '}
                      {a.task.title}
                    </td>
                    <td>{a.task.assigneeName ?? t('unassigned')}</td>
                    <td style={{ textTransform: 'uppercase', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {a.task.status}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {t('daysCount', { count: Math.round(a.staleDays) })}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          background: `${severityColor}22`,
                          color: severityColor,
                        }}
                      >
                        {severityLabel}
                      </span>
                    </td>
                    <td>
                      {showPauseInput === a.task.id ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            type="text"
                            placeholder={t('pauseNotePlaceholder')}
                            value={pauseNote}
                            onChange={(e) => setPauseNote(e.target.value)}
                            style={{
                              width: 100,
                              fontSize: '0.7rem',
                              padding: '2px 6px',
                              borderRadius: 4,
                              border: '1px solid var(--border-subtle)',
                              background: 'var(--bg-elevated)',
                              color: 'var(--text-primary)',
                            }}
                          />
                          <select
                            value={snoozeDays}
                            onChange={(e) => setSnoozeDays(Number(e.target.value))}
                            style={{
                              fontSize: '0.7rem',
                              padding: '2px 4px',
                              borderRadius: 4,
                              border: '1px solid var(--border-subtle)',
                              background: 'var(--bg-elevated)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            <option value={3}>3d</option>
                            <option value={7}>7d</option>
                            <option value={14}>14d</option>
                            <option value={30}>30d</option>
                          </select>
                          <button
                            type="button"
                            className="th-action-btn"
                            onClick={() => markPaused(a.task.id)}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className="th-action-btn"
                            onClick={() => setShowPauseInput(null)}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="th-action-btn"
                          onClick={() => {
                            setShowPauseInput(a.task.id);
                            setPauseNote('');
                            setSnoozeDays(7);
                          }}
                        >
                          {t('pauseItem')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}
