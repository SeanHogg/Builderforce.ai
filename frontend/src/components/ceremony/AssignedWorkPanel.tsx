'use client';

import { useMemo } from 'react';
import type { Task } from '@/lib/builderforceApi';
import { taskStatusLabel } from '@/lib/taskStatus';
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
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const g = m.get(t.status) ?? [];
      g.push(t);
      m.set(t.status, g);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tasks]);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tasks.length} assigned · {member.name}</div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing assigned.</div>
      ) : (
        groups.map(([status, group]) => (
          <div key={status} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {taskStatusLabel(status)} · {group.length}
            </div>
            {group.map((t) => <CeremonyTaskCard key={t.id} task={t} onOpen={onOpenTask} />)}
          </div>
        ))
      )}
    </div>
  );
}
