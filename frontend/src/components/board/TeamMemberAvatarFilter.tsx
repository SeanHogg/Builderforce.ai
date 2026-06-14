'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { Task } from '@/lib/builderforceApi';
import { assigneeName, type TeamMember, type CloudAgentTarget } from '@/lib/taskAssignee';

// Placeholder for TeamMemberAvatar component if it exists, otherwise use InitialAvatar or similar
// For now, we'll create a basic avatar component here.

const Avatar = ({ name, taskCount }: { name: string; taskCount: number }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', padding: '4px' }}>
        <div
            style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: 'var(--bg-deep)', // Placeholder color
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--coral-bright)', // Placeholder color
            }}
        >
            {name.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{taskCount}</span>
    </div>
);

interface TeamMemberAvatarFilterProps {
    tasks: Task[];
    members: TeamMember[];
    cloudAgents: CloudAgentTarget[];
    agentHosts: any[]; // Placeholder for AgentHost type if needed
    onFilterChange: (selectedMembers: string[]) => void;
}

export const TeamMemberAvatarFilter: React.FC<TeamMemberAvatarFilterProps> = ({
    tasks,
    members,
    cloudAgents,
    agentHosts,
    onFilterChange,
}) => {
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

    const memberTaskCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        members.forEach(m => counts[assigneeName(null, null, m.id, [], [], [m])] = 0);
        cloudAgents.forEach(a => counts[assigneeName(null, a.ref, null, [], [a], [])] = 0);
        agentHosts.forEach(h => counts[assigneeName(h.id, null, null, [h], [], [])] = 0);

        tasks.forEach(task => {
            const assigneeName = assigneeName(
                task.assignedAgentHostId,
                task.assignedAgentRef,
                task.assignedUserId,
                agentHosts,
                cloudAgents,
                members
            );
            if (assigneeName !== 'Unassigned' && counts[assigneeName] !== undefined) {
                counts[assigneeName]++;
            }
        });
        return counts;
    }, [tasks, members, cloudAgents, agentHosts]);

    const allWorkforce = useMemo(() => {
        return [
            ...members.map(m => ({ id: `u:${m.id}`, name: m.name, kind: 'human' as const })),
            ...cloudAgents.map(a => ({ id: `c:${a.ref}`, name: a.name, kind: 'cloud_agent' as const })),
            ...agentHosts.map(h => ({ id: `h:${h.id}`, name: h.name, kind: 'host_agent' as const })),
        ];
    }, [members, cloudAgents, agentHosts]);

    const handleMemberClick = (memberId: string) => {
        setSelectedMembers(prev => {
            const newSelected = prev.includes(memberId)
                ? prev.filter(id => id !== memberId)
                : [...prev, memberId];
            onFilterChange(newSelected);
            return newSelected;
        });
    };

    // Filtered workforce to show only those with tasks assigned
    const workforceWithTasks = useMemo(() => {
        return allWorkforce.filter(w => memberTaskCounts[w.name] > 0);
    }, [allWorkforce, memberTaskCounts]);

    return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingBottom: 8 }}>
            {/* "All" filter option */}
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    cursor: 'pointer',
                    padding: '4px',
                    opacity: selectedMembers.length === 0 ? 1 : 0.5,
                }}
                onClick={() => {
                    setSelectedMembers([]);
                    onFilterChange([]);
                }}
            >
                <div
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        backgroundColor: 'var(--bg-deep)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 700,
                        color: 'var(--coral-bright)',
                    }}
                >
                    All
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{tasks.length}</span>
            </div>

            {/* Team member avatars */}
            {workforceWithTasks.map(w => (
                <div
                    key={w.id}
                    onClick={() => handleMemberClick(w.id)}
                    style={{
                        opacity: selectedMembers.includes(w.id) ? 1 : 0.7,
                        border: selectedMembers.includes(w.id) ? '2px solid var(--coral-bright)' : '2px solid transparent',
                        borderRadius: '50%',
                        transition: 'opacity 0.2s, border-color 0.2s',
                    }}
                >
                    <Avatar name={w.name} taskCount={memberTaskCounts[w.name] || 0} />
                </div>
            ))}
        </div>
    );
};
