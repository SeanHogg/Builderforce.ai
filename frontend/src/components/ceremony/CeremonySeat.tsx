'use client';

import { useState } from 'react';
import type { Task } from '@/lib/builderforceApi';
import { InitialAvatar } from '@/components/workforce/WorkforceCard';
import MascotIcon from '@/components/MascotIcon';
import { CeremonyTaskCard } from './CeremonyTaskCard';
import { PowerMeter } from './PowerMeter';
import { BriefcaseBadge } from './BriefcaseBadge';
import { DRAG_TASK, type CeremonyMember } from './types';

const KIND_LABEL: Record<CeremonyMember['kind'], string> = {
  human: 'Human',
  cloud_agent: 'Agent',
  host_agent: 'Remote',
};

/**
 * One seat at the round table. Drop a task here to assign it to this member.
 * A power meter (load vs capacity) sits above the avatar → opens the scorecard;
 * a briefcase below shows assigned-work count → opens the assigned-items panel.
 * The presence ring lights when the member is live; the seat pulses on their turn.
 */
export function CeremonySeat({
  member,
  stackTasks,
  assignedTasks,
  activeLoad,
  cap,
  present,
  isCurrentTurn,
  showStack,
  onDropTask,
  onOpen,
  onOpenScorecard,
  onOpenAssigned,
}: {
  member: CeremonyMember;
  /** Tasks shown in the standup stack under the avatar. */
  stackTasks: Task[];
  /** All tasks owned by this member (briefcase + assigned panel). */
  assignedTasks: Task[];
  /** Active-work count for the power meter. */
  activeLoad: number;
  /** Capacity baseline for the power meter. */
  cap: number;
  present: boolean;
  isCurrentTurn: boolean;
  showStack: boolean;
  onDropTask: (taskId: number) => void;
  onOpen: (task: Task) => void;
  onOpenScorecard: () => void;
  onOpenAssigned: () => void;
}) {
  const [over, setOver] = useState(false);
  const isHuman = member.kind === 'human';
  const ringColor = isCurrentTurn ? 'var(--coral-bright)' : present ? 'var(--cyan-bright)' : 'var(--border-subtle)';

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
        gap: 4,
        width: 140,
        padding: 8,
        borderRadius: 12,
        background: over ? 'var(--surface-coral-soft)' : 'transparent',
        border: over ? '1px dashed var(--coral-bright)' : '1px solid transparent',
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      <PowerMeter load={activeLoad} cap={cap} onClick={onOpenScorecard} />
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
          border: `2px solid ${ringColor}`,
          boxShadow: isCurrentTurn
            ? '0 0 16px var(--shadow-coral-mid)'
            : present ? '0 0 12px var(--cyan-glow)' : 'none',
          ...(isCurrentTurn ? { animation: 'agentPulse 1.4s ease-in-out infinite' } : {}),
        }}
        title={isCurrentTurn ? `${member.name} — speaking` : present ? `${member.name} — live` : member.name}
      >
        {isHuman ? <InitialAvatar label={member.name} /> : <MascotIcon size={28} />}
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
      <BriefcaseBadge tasks={assignedTasks} onClick={onOpenAssigned} />
      {showStack && stackTasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          {stackTasks.slice(0, 4).map((t) => (
            <CeremonyTaskCard key={t.id} task={t} onOpen={onOpen} compact />
          ))}
          {stackTasks.length > 4 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
              +{stackTasks.length - 4} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
