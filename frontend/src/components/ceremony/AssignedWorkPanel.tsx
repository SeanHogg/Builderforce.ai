'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { Task } from '@/lib/builderforceApi';
import { TASK_STATUSES } from '@/lib/taskStatus';
import { useTaskStatusLabel } from '@/lib/taskStatusLabel';
import { CeremonyTaskCard } from './CeremonyTaskCard';
import type { CeremonyMember } from './types';

/**
 * Assigned-work slide-out for one member: their tickets grouped by status (lane),
 * pure-client from the already-loaded tasks. Each card links back to the board.
 */
export function AssignedWorkPanel({
  member,
  tasks,
  onOpenTask,
}: {
  member: CeremonyMember;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  const t = useTranslations('ceremony.assignedWork');
  const statusLabel = useTaskStatusLabel();
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const task of tasks) {
      const g = m.get(task.status) ?? [];
      g.push(task);
      m.set(task.status, g);
    }
    // Kanban order, not alphabetical — a lane list that reads
    // "Backlog, Blocked, Done, In progress" is sorted by a fact nobody cares
    // about. Custom lanes have no canonical position, so they trail in key order.
    return [...m.entries()].sort((a, b) => {
      const ia = TASK_STATUSES.indexOf(a[0] as never);
      const ib = TASK_STATUSES.indexOf(b[0] as never);
      if (ia !== ib) return (ia < 0 ? Number.MAX_SAFE_INTEGER : ia) - (ib < 0 ? Number.MAX_SAFE_INTEGER : ib);
      return a[0].localeCompare(b[0]);
    });
  }, [tasks]);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('assignedTo', { count: tasks.length, name: member.name })}</div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('empty')}</div>
      ) : (
        groups.map(([status, group]) => (
          <div key={status} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {statusLabel(status)} · {group.length}
            </div>
            {group.map((task) => <CeremonyTaskCard key={task.id} task={task} onOpen={onOpenTask} />)}
          </div>
        ))
      )}
    </div>
  );
}
