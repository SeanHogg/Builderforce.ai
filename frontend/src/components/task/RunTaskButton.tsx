'use client';

import type { CSSProperties } from 'react';
import type { Task } from '@/lib/builderforceApi';
import { useTaskRunner } from './useTaskRunner';

/**
 * One-click "Run" — submits the task using its assignee-derived default runtime
 * (see {@link useTaskRunner}/`defaultRunTarget`) with no picker. For changing the
 * runtime/model the full `RunAgentControl` lives on the Agent tab; this is the
 * single-action entry point (e.g. the Details footer). Shares the exact same
 * submit path as the picker, so there is no duplicated run logic.
 */
export function RunTaskButton({
  task,
  label = 'Run',
  onRan,
  onAwaitingApproval,
  style,
}: {
  task: Task;
  label?: string;
  onRan?: (executionId: number) => void;
  onAwaitingApproval?: (g: { approvalId: string; taskId: number; reason: string }) => void;
  style?: CSSProperties;
}) {
  const { run, running, error } = useTaskRunner({ task, onRan, onAwaitingApproval });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={() => run()}
        disabled={running}
        style={{
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 600,
          border: 'none',
          borderRadius: 8,
          background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
          color: '#fff',
          cursor: running ? 'default' : 'pointer',
          opacity: running ? 0.7 : 1,
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          ...style,
        }}
      >
        {running ? 'Running…' : label}
        {!running && (
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: 'currentColor' }}>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)' }}>{error}</div>}
    </div>
  );
}
