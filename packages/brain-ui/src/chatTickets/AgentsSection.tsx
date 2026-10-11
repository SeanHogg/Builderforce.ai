/**
 * Who is working in the chat: the agents invited to it (removable), the sub-agents its
 * runs spawned (live, named with their owner), and the picker that invites another.
 */
import { V } from './tokens';
import { S } from './panelStyles';
import type { AgentOptionVM, ChatAgentVM, ChatSubagentVM, ChatTicketsLabels } from './types';

export function AgentsSection({ agents, subagents, pool, labels, onInvite, onRemove, busy }: {
  agents: ChatAgentVM[]; subagents: readonly ChatSubagentVM[]; pool: AgentOptionVM[]; labels: ChatTicketsLabels;
  onInvite: (ref: string, kind: string) => Promise<void>; onRemove: (id: string) => Promise<void>; busy: boolean;
}) {
  const poolName = (ref: string) => pool.find((p) => p.ref === ref)?.name ?? ref;
  const uninvited = pool.filter((p) => !agents.some((a) => a.agentRef === p.ref));
  return (
    <div style={{ ...S.section, flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {agents.length + subagents.length === 0 ? <span style={S.muted}>{labels.noAgents}</span> : agents.map((a) => (
          <span key={a.id} style={S.agentChip}>
            <span aria-hidden>🤖</span>{poolName(a.agentRef)}
            <button type="button" title={labels.removeAgent} disabled={busy} onClick={() => void onRemove(a.id)} style={{ ...S.icon, fontSize: 11 }}>✕</button>
          </span>
        ))}
        {subagents.map((c) => (
          <span key={c.key} style={S.agentChip} title={c.label}>
            <span aria-hidden>🤖</span>{c.name}
            <span style={{ fontSize: 11, color: V.muted }}>{c.handle} · {labels.subagentOf.replace('{owner}', c.owner)}</span>
          </span>
        ))}
      </div>
      <select aria-label={labels.inviteAgent} value="" onChange={(e) => { const p = pool.find((x) => x.ref === e.target.value); if (p) void onInvite(p.ref, p.kind); }} style={{ ...S.select, maxWidth: 260 }}>
        <option style={S.option} value="">{labels.inviteAgent}</option>
        {uninvited.map((p) => <option style={S.option} key={p.ref} value={p.ref}>{p.name} — {p.meta}</option>)}
      </select>
      <span style={{ fontSize: 11, ...S.muted }}>{labels.agentsHint}</span>
    </div>
  );
}
