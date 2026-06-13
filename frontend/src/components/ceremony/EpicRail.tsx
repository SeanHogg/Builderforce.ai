'use client';

import { useState } from 'react';
import type { Task } from '@/lib/builderforceApi';
import { DRAG_TASK } from './types';

/** One Epic container — a drop target that nests the dropped task under the Epic. */
function EpicCard({
  epic,
  childCount,
  onDropTask,
  onOpen,
}: {
  epic: Task;
  childCount: number;
  onDropTask: (taskId: number) => void;
  onOpen: (task: Task) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = Number(e.dataTransfer.getData(DRAG_TASK));
        if (id && id !== epic.id) onDropTask(id);
      }}
      onClick={() => onOpen(epic)}
      style={{
        padding: 10,
        borderRadius: 10,
        cursor: 'pointer',
        background: over ? 'var(--surface-coral-soft)' : 'var(--bg-base)',
        border: `1px ${over ? 'dashed var(--coral-bright)' : 'solid var(--border-subtle)'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
      title={epic.title}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden>🗂️</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {epic.title}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {childCount} {childCount === 1 ? 'task' : 'tasks'}
      </div>
    </div>
  );
}

/**
 * The Epics rail (planning mode). Drag a backlog task onto an Epic to group it
 * (sets parentTaskId). "+ New Epic" promotes a new planning container.
 */
export function EpicRail({
  epics,
  childCountByEpic,
  onDropToEpic,
  onCreateEpic,
  onOpen,
}: {
  epics: Task[];
  childCountByEpic: Map<number, number>;
  onDropToEpic: (taskId: number, epicId: number) => void;
  onCreateEpic: () => void;
  onOpen: (task: Task) => void;
}) {
  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        borderRadius: 12,
        background: 'var(--bg-deep)',
        border: '1px solid var(--border-subtle)',
        maxHeight: '100%',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Epics
        </span>
        <button
          type="button"
          onClick={onCreateEpic}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--coral-bright)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          + New
        </button>
      </div>
      {epics.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0', textAlign: 'center' }}>
          No epics yet
        </div>
      ) : (
        epics.map((e) => (
          <EpicCard
            key={e.id}
            epic={e}
            childCount={childCountByEpic.get(e.id) ?? 0}
            onDropTask={(taskId) => onDropToEpic(taskId, e.id)}
            onOpen={onOpen}
          />
        ))
      )}
    </div>
  );
}
