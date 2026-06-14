'use client';

import { useState, useMemo, useRef, useEffect, type CSSProperties } from 'react';
import type { AgentHost } from '@/lib/builderforceApi';
import type { CloudAgentTarget, TeamMember } from '@/lib/taskAssignee';

/**
 * One clickable avatar chip in the member filter row. Shows a circular initial
 * badge with a count badge below it. Active state is a highlighted border.
 */
function AvatarChip({
  label,
  count,
  active,
  onClick,
  isAll,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  isAll?: boolean;
}) {
  const chipStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    cursor: 'pointer',
    padding: 2,
    borderRadius: 12,
    border: active ? '2px solid var(--coral-bright)' : '2px solid transparent',
    transition: 'border-color 0.15s, opacity 0.15s',
    opacity: active ? 1 : 0.6,
    flexShrink: 0,
    minWidth: 44,
  };

  const avatarStyle: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: active ? 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))' : 'var(--bg-deep)',
    color: active ? '#fff' : 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1,
  };

  const badgeStyle: CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-muted)',
    lineHeight: 1.2,
  };

  return (
    <div style={chipStyle} onClick={onClick} title={`${label} — ${count} task${count !== 1 ? 's' : ''}`} role="button" tabIndex={0}>
      <div style={avatarStyle}>
        {isAll ? 'A' : label.slice(0, 1).toUpperCase()}
      </div>
      <span style={badgeStyle}>{count}</span>
    </div>
  );
}

export interface TeamMemberAvatarFilterProps {
  /** All tasks currently visible on the board (unfiltered by assignee). */
  tasks: Array<{
    assignedAgentHostId?: number | null;
    assignedAgentRef?: string | null;
    assignedUserId?: string | null;
  }>;
  /** Human teammates. */
  members: TeamMember[];
  /** Cloud agents. */
  cloudAgents: CloudAgentTarget[];
  /** Self-hosted agent hosts. */
  agentHosts: AgentHost[];
  /** Currently selected member keys (encoded `h:<id>` / `c:<ref>` / `u:<id>`). */
  selectedKeys: string[];
  /** Called when the selection changes. */
  onChange: (keys: string[]) => void;
}

/**
 * A row of clickable team member avatars that filter the task board by
 * assigned member(s). Supports multiple selection (OR logic). The first chip
 * is an "All" chip that clears all selections. Responsive via horizontal
 * scroll on overflow.
 */
export function TeamMemberAvatarFilter({
  tasks,
  members,
  cloudAgents,
  agentHosts,
  selectedKeys,
  onChange,
}: TeamMemberAvatarFilterProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButtons, setShowScrollButtons] = useState(false);

  // Check if the container overflows for scroll-button affordance.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setShowScrollButtons(el.scrollWidth > el.clientWidth + 8);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build a unified list: every member/host/agent that has at least one
  // assigned task in the current (pre-filtered) set. The key is the same
  // encoded form used by assigneeSelectValue so filtering is a simple match.
  const workforceChips = useMemo(() => {
    // Count assignments per member for the badge
    const counts = new Map<string, number>();
    const names = new Map<string, string>();

    // Seed every known assignable so names are always resolved
    for (const m of members) {
      const k = `u:${m.id}`;
      counts.set(k, 0);
      names.set(k, m.name);
    }
    for (const a of cloudAgents) {
      const k = `c:${a.ref}`;
      counts.set(k, 0);
      names.set(k, a.name);
    }
    for (const h of agentHosts) {
      const k = `h:${h.id}`;
      counts.set(k, 0);
      names.set(k, h.name);
    }

    // Tally from the tasks
    for (const t of tasks) {
      let k = '';
      let name = '';
      if (t.assignedAgentHostId != null) {
        k = `h:${t.assignedAgentHostId}`;
        const host = agentHosts.find((h) => h.id === t.assignedAgentHostId);
        name = host?.name ?? String(t.assignedAgentHostId);
      } else if (t.assignedAgentRef) {
        k = `c:${t.assignedAgentRef}`;
        const ca = cloudAgents.find((a) => a.ref === t.assignedAgentRef);
        name = ca?.name ?? t.assignedAgentRef;
      } else if (t.assignedUserId) {
        k = `u:${t.assignedUserId}`;
        const m = members.find((m) => m.id === t.assignedUserId);
        name = m?.name ?? t.assignedUserId;
      }
      if (k) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
        if (name) names.set(k, name);
      }
    }

    // Only surface members with at least one task
    const result: Array<{ key: string; name: string; count: number }> = [];
    for (const [k, count] of counts) {
      if (count > 0) {
        result.push({ key: k, name: names.get(k) ?? k, count });
      }
    }
    // Sort alphabetically by name
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }, [tasks, members, cloudAgents, agentHosts]);

  const totalCount = workforceChips.reduce((sum, c) => sum + c.count, 0);

  // Scroll helpers
  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -160, behavior: 'smooth' });
  };
  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 160, behavior: 'smooth' });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
      {showScrollButtons && (
        <button
          type="button"
          onClick={scrollLeft}
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-deep)',
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
          aria-label="Scroll left"
        >
          ◀
        </button>
      )}

      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          gap: 4,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollSnapType: 'x proximity',
          paddingBottom: 2,
          flex: 1,
          scrollbarWidth: 'thin',
        }}
      >
        {/* "All" chip — clear all selections */}
        <AvatarChip
          label="All"
          count={totalCount}
          active={selectedKeys.length === 0}
          onClick={() => onChange([])}
          isAll
        />

        {/* One chip per assignable with tasks */}
        {workforceChips.map((chip) => (
          <AvatarChip
            key={chip.key}
            label={chip.name}
            count={chip.count}
            active={selectedKeys.includes(chip.key)}
            onClick={() => {
              if (selectedKeys.includes(chip.key)) {
                onChange(selectedKeys.filter((k) => k !== chip.key));
              } else {
                onChange([...selectedKeys, chip.key]);
              }
            }}
          />
        ))}

        {/* Empty state */}
        {workforceChips.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
            No assigned tasks
          </span>
        )}
      </div>

      {showScrollButtons && (
        <button
          type="button"
          onClick={scrollRight}
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-deep)',
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
          aria-label="Scroll right"
        >
          ▶
        </button>
      )}
    </div>
  );
}