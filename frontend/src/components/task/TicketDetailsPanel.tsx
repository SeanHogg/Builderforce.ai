'use client';

import { useEffect, useState } from 'react';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { tasksApi, type Task } from '@/lib/builderforceApi';

export interface TicketDetailsPanelProps {
  taskId: number | null;
  onClose: () => void;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Reusable, read-only ticket drill-down for contextual links outside the board. */
export function TicketDetailsPanel({ taskId, onClose }: TicketDetailsPanelProps) {
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
        if (active) setError(reason instanceof Error ? reason.message : 'Failed to load ticket');
      },
    ).finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [taskId]);

  const facts = task ? [
    ['Status', task.status],
    ['Priority', task.priority],
    ['Type', task.taskType],
    ['Created', formatDate(task.createdAt)],
    ['Updated', formatDate(task.updatedAt)],
    ['Due', formatDate(task.dueDate)],
  ] : [];

  return (
    <SlideOutPanel open={taskId != null} onClose={onClose} title={task ? `${task.key} · ${task.title}` : 'Ticket details'}>
      <div style={{ padding: 20 }}>
        {loading && <div className="text-muted">Loading ticket...</div>}
        {error && (
          <div style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--surface-rose-soft)' }}>
            {error}
          </div>
        )}
        {task && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {task.restricted ? (
              <div style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                This security ticket requires additional clearance to view.
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  {facts.map(([label, value]) => (
                    <div key={label} style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
                      <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>{label}</div>
                      <div style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{value}</div>
                    </div>
                  ))}
                </div>
                <section>
                  <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Description</h3>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {task.description || 'No description provided.'}
                  </div>
                </section>
                {task.githubPrUrl && (
                  <a href={task.githubPrUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ alignSelf: 'flex-start' }}>
                    View pull request{task.githubPrNumber ? ` #${task.githubPrNumber}` : ''}
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
