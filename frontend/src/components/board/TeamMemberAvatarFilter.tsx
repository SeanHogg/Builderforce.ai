'use client';

import { Fragment, useMemo, useRef, type MouseEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import type { TeamMember } from '@/lib/taskAssignee';
import type { CloudAgentTarget } from '@/lib/taskAssignee';
import type { AgentHost } from '@/lib/builderforceApi';
import type { Task } from '@/lib/builderforceApi';

/** A filterable entity: a human teammate, self-hosted agent host, or cloud agent
 *  that has tasks assigned to it on the current board. Joins the three assignee
 *  pools into one uniform list for the avatar filter row. */
export interface FilterableAssignee {
  /** Unique stable key (h:id / c:ref / u:userId). */
  key: string;
  /** Display name. */
  name: string;
  /** Task count this assignee owns. */
  count: number;
  /** Deterministic colour for the avatar. */
  color?: string;
  /** Whether this is a human teammate (for avatar colouring). */
  isHuman?: boolean;
  /** Avatar URL if available (for future use). */
  avatarUrl?: string;
}

export interface TeamMemberAvatarFilterProps {
  /** All tasks currently visible on the board (pre-filtered by search/status/priority). */
  tasks: Task[];
  /** Human teammates assignable on this board (scoped by project workforce). */
  members: TeamMember[];
  /** Self-hosted agent hosts assignable on this board. */
  agentHosts: AgentHost[];
  /** Cloud agent targets assignable on this board. */
  cloudAgents: CloudAgentTarget[];
  /** Currently selected assignee keys (h:id / c:ref / u:userId). Empty = show all. */
  selectedAssignees: string[];
  /** Called when the selection changes. Passes the full set of selected keys. */
  onSelectAssignees: (keys: string[]) => void;
  /** Optional label override. Defaults to "All". */
  allLabel?: string;
  /** Whether the "All" (clear) option is disabled. Default false. */
  disableAll?: boolean;
}

/**
 * Row of clickable team member avatars that filter the task board by assignee.
 * Supports multi-select (OR logic), count badges, visual active state, and a
 * clear/reset "All" option. Adapts to small viewports with horizontal scrolling.
 *
 * Composes with existing search/status/priority filters — it never touches the
 * task query, only filters the `tasks` array passed in, so the parent can chain
 * the avatar filter result on top of the other filters.
 */
export function TeamMemberAvatarFilter({
  tasks,
  members,
  agentHosts,
  cloudAgents,
  selectedAssignees,
  onSelectAssignees,
  allLabel = 'All',
  disableAll = false,
}: TeamMemberAvatarFilterProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build a uniform list of filterable assignees from tasks + the three pools.
  // Each task contributes to the count of its assignee. Assignees with zero tasks
  // are omitted so the row stays concise.
  const assignees = useMemo<FilterableAssignee[]>(() => {
    // Map from assignee key → count
    const counts = new Map<string, number>();
    for (const t of tasks) {
      const key = assigneeTaskKey(t);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const result: FilterableAssignee[] = [];

    // Human teammates
    for (const m of members) {
      const key = `u:${m.id}`;
      const count = counts.get(key) ?? 0;
      if (count > 0) {
        result.push({ key, name: m.name, count, isHuman: true });
      }
    }

    // Self-hosted agent hosts
    for (const h of agentHosts) {
      const key = `h:${h.id}`;
      const count = counts.get(key) ?? 0;
      if (count > 0) {
        result.push({ key, name: h.name, count, isHuman: false });
      }
    }

    // Cloud agents
    for (const a of cloudAgents) {
      const key = `c:${a.ref}`;
      const count = counts.get(key) ?? 0;
      if (count > 0) {
        result.push({ key, name: a.name, count, isHuman: false });
      }
    }

    // Sort: highest count first, then alphabetically
    result.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [tasks, members, agentHosts, cloudAgents]);

  const allSelected = selectedAssignees.length === 0;
  const hasSelection = selectedAssignees.length > 0;

  const handleToggle = (e: MouseEvent, key: string) => {
    e.stopPropagation();
    const next = selectedAssignees.includes(key)
      ? selectedAssignees.filter((k) => k !== key)
      : [...selectedAssignees, key];
    onSelectAssignees(next);
  };

  const handleSelectAll = (e: MouseEvent) => {
    e.stopPropagation();
    onSelectAssignees([]);
  };

  // No assignees to filter by → hide the entire filter row
  if (assignees.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: '100%',
      }}
    >
      {/* "All" chip — reset filter */}
      <button
        type="button"
        onClick={handleSelectAll}
        disabled={disableAll}
        aria-label="Show all tasks"
        title="Show all tasks (clear assignee filter)"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 36,
          padding: '0 12px',
          borderRadius: 18,
          fontSize: 12,
          fontWeight: 600,
          border: `2px solid ${allSelected ? 'var(--coral-bright, #f4726e)' : 'var(--border-subtle)'}`,
          background: allSelected ? 'var(--coral-bright, #f4726e)' : 'var(--bg-elevated)',
          color: allSelected ? '#fff' : 'var(--text-secondary)',
          cursor: disableAll ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          opacity: disableAll ? 0.5 : 1,
          transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          padding: 0,
          fontFamily: 'inherit',
          outline: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {allLabel}
      </button>

      {hasSelection && assignees.length > 0 && (
        <button
          type="button"
          onClick={() => onSelectAssignees([])}
          aria-label="Clear selected assignees"
          title="Clear selected assignees"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 28,
            width: 28,
            borderRadius: '50%',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        >
          ✕
        </button>
      )}

      {/* Scrollable avatar row */}
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
          paddingBottom: 2,
          flex: 1,
          minWidth: 0,
        }}
      >
        {assignees.map((a) => {
          const active = selectedAssignees.includes(a.key);
          return (
            <Avatar
              key={a.key}
              name={a.name}
              count={a.count}
              active={active}
              onClick={(e) => handleToggle(e, a.key)}
              title={`${a.name} — ${a.count} task${a.count !== 1 ? 's' : ''}${active ? ' (filtering)' : ' — click to filter'}`}
              size={36}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Extract the assignee filter key from a task. Returns null for unassigned tasks.
 * Mirrors assigneeSelectValue in taskAssignee.ts.
 */
export function assigneeTaskKey(task: Task): string | null {
  if (task.assignedAgentHostId != null) return `h:${task.assignedAgentHostId}`;
  if (task.assignedAgentRef) return `c:${task.assignedAgentRef}`;
  if (task.assignedUserId) return `u:${task.assignedUserId}`;
  return null;
}