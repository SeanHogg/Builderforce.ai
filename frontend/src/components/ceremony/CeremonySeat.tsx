'use client';

import { useState } from 'react';
import type { Task } from '@/lib/builderforceApi';
import { InitialAvatar } from '@/components/workforce/WorkforceCard';
import MascotIcon from '@/components/MascotIcon';
import { CeremonyTaskCard } from './CeremonyTaskCard';
import { DRAG_TASK, type CeremonyMember } from './types';

const KIND_LABEL: Record<CeremonyMember['kind'], string> = {
  human: 'Human',
  cloud_agent: 'Agent',
  host_agent: 'Remote',
};

/**
 * One seat at the round table. Drop a task here to assign it to this member.
 * In standup mode the seat shows the member's in-flight tickets; the presence
 * ring lights when that member is live in the room.
 */
export function CeremonySeat({
  member,
  tasks,
  present,
  showStack,
  onDropTask,
  onOpen,
}: {
  member: CeremonyMember;
  tasks: Task[];
  present: boolean;
  /** Standup: render the member's in-flight task stack under the avatar. */
  showStack: boolean;
  onDropTask: (taskId: number) => void;
  onOpen: (task: Task) => void;
}) {
  const [over, setOver] = useState(false);
  const isHuman = member.kind === 'human';

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = Number(e.dataTransfer.getData(DRAG_TASK));
        if (id) onDropTask(id);
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        width: 140,
        padding: 8,
        borderRadius: 12,
        background: over ? 'var(--surface-coral-soft)' : 'transparent',
        border: over ? '1px dashed var(--coral-bright)' : '1px solid transparent',
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-elevated)',
          border: `2px solid ${present ? 'var(--cyan-bright)' : 'var(--border-subtle)'}`,
          boxShadow: present ? '0 0 12px var(--cyan-glow)' : 'none',
        }}
        title={present ? `${member.name} — live` : member.name}
      >
        {isHuman ? <InitialAvatar label={member.name} /> : <MascotIcon size={28} />}
        {tasks.length > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 9,
              background: 'var(--coral-bright)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {tasks.length}
          </span>
        )}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            maxWidth: 130,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {member.name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{KIND_LABEL[member.kind]}</div>
      </div>
      {showStack && tasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          {tasks.slice(0, 4).map((t) => (
            <CeremonyTaskCard key={t.id} task={t} onOpen={onOpen} compact />
          ))}
          {tasks.length > 4 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
              +{tasks.length - 4} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
