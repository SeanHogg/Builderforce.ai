'use client';

import { RoleGate } from '@/components/RoleGate';
import { EXECUTION_STATUS_COLOR, rerunAffordance, type RerunAffordance } from '../board/AgentChip';

/**
 * Selectable execution pill (`#<id> · <status>`) used in the task Agent tab's
 * execution list. When the run is in a re-runnable state it grows an inline
 * action icon — a retry glyph for failed/cancelled runs, a play glyph for a
 * (future) paused run — so the user can kick it off again without scrolling back
 * up to the Run control. The chip decides for itself whether that icon shows
 * (via {@link rerunAffordance}); the parent only supplies the action.
 *
 * SELECTING a chip is a read (it just changes which run you're looking at) and
 * stays open to everyone. Re-running is a DISPATCH, so the affordance carries its
 * own DEVELOPER+ gate here rather than at the parent — per repo rule, the shared
 * control decides its own state.
 */
export interface ExecutionChipProps {
  id: number;
  status: string;
  selected: boolean;
  onSelect: () => void;
  /** Re-run/resume this execution. Omit to never show the action (e.g. read-only). */
  onRerun?: () => void;
  /** True while this chip's re-run request is in flight. */
  rerunning?: boolean;
  /** Name of the agent that ran this execution — shown as a hover tooltip so the
   *  per-run agent is discoverable across the whole list, not just the selected run. */
  agentName?: string;
}

const ICON: Record<RerunAffordance, { path: string; title: string }> = {
  // Circular-arrow retry glyph.
  retry: { path: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 16.24 7.76L13 11h7V4z', title: 'Re-run this task' },
  // Play triangle (resume).
  resume: { path: 'M8 5v14l11-7z', title: 'Resume this run' },
};

export function ExecutionChip({ id, status, selected, onSelect, onRerun, rerunning, agentName }: ExecutionChipProps) {
  const color = EXECUTION_STATUS_COLOR[status] ?? 'var(--text-secondary)';
  const affordance = onRerun ? rerunAffordance(status) : null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${selected ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
        background: selected ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        title={agentName ? `Ran by ${agentName}` : undefined}
        style={{
          padding: '6px 10px', fontSize: 12, cursor: 'pointer',
          border: 'none', background: 'none', color,
        }}
      >
        #{id} · {status}
      </button>
      {affordance && (
        <RoleGate capability="runtime.execute" style={{ alignSelf: 'stretch' }}>
          <button
            type="button"
            onClick={rerunning ? undefined : onRerun}
            disabled={rerunning}
            title={ICON[affordance].title}
            aria-label={ICON[affordance].title}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 8px', border: 'none', borderLeft: '1px solid var(--border-subtle)',
              background: 'none', color: 'var(--coral-bright)',
              cursor: rerunning ? 'default' : 'pointer', opacity: rerunning ? 0.5 : 1,
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: 'currentColor' }} aria-hidden>
              <path d={ICON[affordance].path} />
            </svg>
          </button>
        </RoleGate>
      )}
    </span>
  );
}
