
'use client';

import { CSSProperties, useMemo } from 'react';
import {
  type Task,
  type AgentHost,
} from '@/lib/builderforceApi';
import {
  assigneeName,
  assigneeSelectValue,
  type CloudAgentTarget,
  type TeamMember,
} from '@/lib/taskAssignee';

// Styles for the filter chips.
const filterChipStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 16,
  fontSize: 12,
  cursor: 'pointer',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  transition: 'background-color 0.2s, border-color 0.2s',
};

const filterChipActiveStyle: CSSProperties = {
  background: 'var(--coral-bright)',
  borderColor: 'var(--coral-bright)',
  color: '#fff',
};

const badgeStyle: CSSProperties = {
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 8,
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  minWidth: 18,
  textAlign: 'center',
};

const badgeActiveStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.3)',
  color: '#fff',
};


export interface TeamMemberAvatarFilterProps {
  tasks: Task[];
  agentHosts: AgentHost[];
  cloudAgents: CloudAgentTarget[];
  members: TeamMember[];
  selectedAssignees: string[]; // Array of assigneeSelectValue strings
  onSelectAssignees: (assigneeKeys: string[]) => void;
}

export function TeamMemberAvatarFilter({
  tasks,
  agentHosts,
  cloudAgents,
  members,
  selectedAssignees,
  onSelectAssignees,
}: TeamMemberAvatarFilterProps) {
  // Aggregate all possible assignees and their task counts.
  const allAssignees = useMemo(() => {
    const assigneeMap = new Map<string, { name: string; count: number; avatar?: string }>();

    // Add an "All" option for clearing filters
    assigneeMap.set('', { name: 'All', count: 0 });

    [
      ...members.map((m) => ({ kind: 'u', ref: m.id, name: m.name })),
      ...agentHosts.map((h) => ({ kind: 'h', ref: String(h.id), name: h.name })),
      ...cloudAgents.map((a) => ({ kind: 'c', ref: a.ref, name: a.name })),
    ].forEach((assignee) => {
      const key = `${assignee.kind}:${assignee.ref}`;
      assigneeMap.set(key, { name: assignee.name, count: 0 });
    });

    // Calculate task counts
    for (const task of tasks) {
      const assigneeKey = assigneeSelectValue(
        task.assignedAgentHostId,
        task.assignedAgentRef,
        task.assignedUserId,
      );
      if (assigneeKey) {
        const current = assigneeMap.get(assigneeKey);
        if (current) {
          assigneeMap.set(assigneeKey, { ...current, count: current.count + 1 });
        } else {
          // In case a task has an assignee not in the initial lists
          assigneeMap.set(assigneeKey, {
            name: assigneeName(
              task.assignedAgentHostId,
              task.assignedAgentRef,
              task.assignedUserId,
              agentHosts,
              cloudAgents,
              members,
            ),
            count: 1,
          });
        }
      } else {
        // Unassigned tasks also increment the "All" count conceptually, or could be a dedicated "Unassigned" chip
        // For now, they contribute to the total count if 'All' is selected.
        const all = assigneeMap.get('');
        if (all) assigneeMap.set('', { ...all, count: all.count + 1 });
      }
    }

    // Sort assignees: "All" first, then alphabetically by name
    return Array.from(assigneeMap.entries())
      .filter(([, data]) => data.count > 0 || data.name === 'All') // Only show assignees with tasks, or the 'All' chip
      .sort(([keyA, dataA], [keyB, dataB]) => {
        if (keyA === '') return -1; // "All" first
        if (keyB === '') return 1;
        return dataA.name.localeCompare(dataB.name);
      })
      .map(([key, data]) => ({ key, ...data }));
  }, [tasks, agentHosts, cloudAgents, members]);

  const handleSelect = (assigneeKey: string) => {
    if (assigneeKey === '') {
      // "All" selected, clear all other selections
      onSelectAssignees([]);
    } else if (selectedAssignees.includes(assigneeKey)) {
      // Deselect if already selected
      onSelectAssignees(selectedAssignees.filter((id) => id !== assigneeKey));
    } else {
      // Select new, clearing "All" if it was selected, and add new assignee
      onSelectAssignees([...selectedAssignees.filter(id => id !== ''), assigneeKey]);
    }
  };

  const currentTaskCount = selectedAssignees.length === 0
    ? tasks.length
    : tasks.filter(task => selectedAssignees.includes(assigneeSelectValue(task.assignedAgentHostId, task.assignedAgentRef, task.assignedUserId))).length;


  // For the 'All' chip, show total task count.
  const allChipCount = tasks.length;

  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
      {allAssignees.map(({ key, name, count }) => {
        const isActive = (key === '' && selectedAssignees.length === 0) || (key !== '' && selectedAssignees.includes(key));
        const displayCount = key === '' ? allChipCount : count;
        if (displayCount === 0 && key !== '') return null; // Only show assignees with tasks, or the 'All' chip

        return (
          <button
            key={key || 'all'}
            type="button"
            onClick={() => handleSelect(key)}
            style={{ ...filterChipStyle, ...(isActive ? filterChipActiveStyle : {}) }}
          >
            {/* TODO: Replace with actual avatar images */}
            <div style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--bg-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              color: isActive ? '#fff' : 'var(--text-primary)',
              flexShrink: 0,
            }}>
              {name.charAt(0).toUpperCase()}
            </div>
            {name === 'All' ? 'All' : name}
            {displayCount > 0 && (
              <span style={{ ...badgeStyle, ...(isActive ? badgeActiveStyle : {}) }}>
                {displayCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
