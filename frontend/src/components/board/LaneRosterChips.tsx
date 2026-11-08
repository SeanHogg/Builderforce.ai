import type { SwimlaneAgent } from '@/lib/builderforceApi';
import type { BoardTicketOwner } from '@/lib/boardRostersApi';
import { AgentChip } from './AgentChip';
import { TicketOwnerChips } from './TicketOwnerChips';

/** A lane header's roster: its staffed agents (with live dispatch status) then the hosts that own tickets in it. */
export function LaneRosterChips({ agents, owners, dispatchByAssignment, title }: {
  agents: readonly SwimlaneAgent[];
  owners: readonly BoardTicketOwner[];
  dispatchByAssignment: ReadonlyMap<string, { status: string }>;
  title: string;
}) {
  if (agents.length === 0 && owners.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} title={title}>
      {agents.map((a) => {
        const disp = dispatchByAssignment.get(a.id);
        const label = a.name ?? a.role;
        return (
          <AgentChip
            key={a.id}
            label={label}
            status={disp?.status}
            meta={a.model ?? a.runtime}
            title={`${label} · ${a.runtime}${a.model ? ` · ${a.model}` : ''}${disp ? ` — ${disp.status}` : ''}`}
          />
        );
      })}
      <TicketOwnerChips owners={owners} />
    </div>
  );
}
