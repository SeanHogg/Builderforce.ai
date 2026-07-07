'use client';

import { useState } from 'react';
import type { Task } from '@/lib/builderforceApi';
import { useIsMobile } from '@/lib/useIsMobile';
import { CeremonyTaskCard } from './CeremonyTaskCard';
import { DRAG_TASK } from './types';

/**
 * The backlog rail — the pool of unscheduled/unassigned work a ceremony pulls
 * from. Cards drag out onto seats (assign), Epics (group), or a sprint
 * (schedule). The rail is itself a drop target so a task can be sent BACK to the
 * backlog (clears assignee / sprint via onReturn).
 */
export function BacklogRail({
  tasks,
  title = 'Backlog',
  onOpen,
  onReturn,
}: {
  tasks: Task[];
  title?: string;
  onOpen: (task: Task) => void;
  /** Drop a task here to return it to the backlog (unassign / unschedule). */
  onReturn?: (taskId: number) => void;
}) {
  const [over, setOver] = useState(false);
  const isMobile = useIsMobile();
  return (
    <div
      onDragOver={onReturn ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={onReturn ? () => setOver(false) : undefined}
      onDrop={onReturn ? (e) => {
        e.preventDefault();
        setOver(false);
        const id = Number(e.dataTransfer.getData(DRAG_TASK));
        if (id) onReturn(id);
      } : undefined}
      style={{
        width: isMobile ? '100%' : 240,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        borderRadius: 12,
        background: over ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
        border: `1px ${over ? 'dashed var(--coral-bright)' : 'solid var(--border-subtle)'}`,
        maxHeight: isMobile ? 260 : '100%',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {title}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0', textAlign: 'center' }}>
          Nothing here
        </div>
      ) : (
        tasks.map((t) => <CeremonyTaskCard key={t.id} task={t} onOpen={onOpen} />)
      )}
    </div>
  );
}
