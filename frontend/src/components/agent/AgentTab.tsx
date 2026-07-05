'use client';

import { useState } from 'react';
import type { Task, AgentHost } from '@/lib/builderforceApi';
import { AgentCapabilitiesContent } from '../AgentCapabilitiesContent';
import { KanbanRosterCard } from '../kanban/KanbanRosterCard';
import { AgentExecutionPanel } from './AgentExecutionPanel';

/**
 * The single reusable "Agent / Capabilities" tab, shared by the project details
 * panel and the task drawer.
 *
 * - Project scope: shows the project's agents + capabilities (skills, personas,
 *   content, governance, cron, observability).
 * - Task scope: additionally shows the live execution panel on top — queue a run
 *   and watch its output / changes / tools stream, and chat to steer the agent.
 *
 * Merging these into one component removes the previous split between the
 * project "Capabilities" tab and the task "Agent" tab.
 */
export interface AgentTabProps {
  projectId: number;
  agentHostId?: number;
  tenantId?: string;
  /** When provided, the live execution panel is shown for this task. */
  task?: Task;
  agentHosts?: AgentHost[];
  onTaskChanged?: () => void;
}

export function AgentTab({ projectId, agentHostId, tenantId, task, agentHosts, onTaskChanged }: AgentTabProps) {
  // Task scope leads with the live run; capabilities are collapsed by default so
  // the execution stays the focus but stay one click away.
  const [showCapabilities, setShowCapabilities] = useState(!task);

  return (
    <div>
      {task && (
        <AgentExecutionPanel task={task} agentHosts={agentHosts ?? []} onTaskChanged={onTaskChanged} />
      )}

      {task ? (
        <div style={{ padding: '0 20px 20px' }}>
          <button
            type="button"
            onClick={() => setShowCapabilities((v) => !v)}
            style={{
              width: '100%', textAlign: 'left', padding: '10px 0', fontSize: 14, fontWeight: 600,
              color: 'var(--text-primary)', background: 'none', border: 'none', borderTop: '1px solid var(--border-subtle)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ transform: showCapabilities ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--text-muted)' }}>▶</span>
            Agents &amp; capabilities
          </button>
          {showCapabilities && (
            <AgentCapabilitiesContent projectId={projectId} agentHostId={agentHostId} tenantId={tenantId} style={{ marginTop: 12 }} />
          )}
        </div>
      ) : (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Recommended roster — the accurate multi-agent view (agents assigned to
              each role), moved here from the Analytics tab. The Agents list below
              only reflects agents explicitly attached via "+ Add Agent", so the
              roster is where the full team shows. */}
          <KanbanRosterCard projectId={projectId} />
          <AgentCapabilitiesContent projectId={projectId} agentHostId={agentHostId} tenantId={tenantId} />
        </div>
      )}
    </div>
  );
}
