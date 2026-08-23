'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { tasksApi, type Task } from '@/lib/builderforceApi';
import { useFormat } from "@/i18n/useFormat";

export interface TicketDetailsPanelProps {
  taskId: number | null;
  onClose: () => void;
}


/** Reusable, read-only ticket drill-down for contextual links outside the board. */
export function TicketDetailsPanel({ taskId, onClose }: TicketDetailsPanelProps) {
  const fmt = useFormat();
  const t = useTranslations('ticketDetailsPanel');
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setTask(null);
    setError(null);
    if (taskId == null) return () => { active = false; };

    setLoading(true);
    void tasksApi.get(taskId).then(
      (result) => { if (active) setTask(result); },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : t('loading'));
      },
    ).finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [taskId, t]);

  const facts = task ? [
    [t('factStatus'), task.status],
    [t('factPriority'), task.priority],
    [t('factType'), task.taskType],
    [t('factCreated'), fmt.dateTime(task.createdAt)],
    [t('factUpdated'), fmt.dateTime(task.updatedAt)],
    [t('factDue'), fmt.dateTime(task.dueDate)],
  ] : [];

  return (
    <SlideOutPanel open={taskId != null} onClose={onClose} title={task ? `${task.key} · ${task.title}` : t('titleFallback')} widthStorageKey="ticket-details">
      <div style={{ padding: 20 }}>
        {loading && <div className="text-muted">{t('loading')}</div>}
        {error && (
          <div style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)' }}>
            {error}
          </div>
        )}
        {task && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {task.restricted ? (
              <div style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                {t('restricted')}
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  {facts.map(([label, value]) => (
                    <div key={label} style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)' }}>
                      <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>{label}</div>
                      <div style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{value}</div>
                    </div>
                  ))}
                </div>
                <section>
                  <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>{t('descriptionHeading')}</h3>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {task.description || t('noDescription')}
                  </div>
                </section>
                {task.githubPrUrl && (
                  <a href={task.githubPrUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ alignSelf: 'flex-start' }}>
                    {t('viewPr')}{task.githubPrNumber ? ` #${task.githubPrNumber}` : ''}
                  </a>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </SlideOutPanel>
  );
}
