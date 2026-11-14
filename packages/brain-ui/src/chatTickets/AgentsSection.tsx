/**
 * Who is in the chat: the AGENTS invited to it (removable), the sub-agents its runs
 * spawned (live, named with their owner), and the picker that invites another — plus
 * the PEOPLE (members and pending invites, the shared/locked toggle) below a divider.
 * One consolidated "who's here" drawer; the rail used to split this into two pills.
 */
import { useState } from 'react';
import { V } from './tokens';
import { S } from './panelStyles';
import type { AgentOptionVM, ChatAgentVM, ChatMemberVM, ChatSubagentVM, ChatTicketsLabels } from './types';

export function AgentsSection({ agents, subagents, pool, members, labels, visibility, onSetVisibility, onInviteAgent, onRemoveAgent, onInviteMember, onRemoveMember, busy }: {
  agents: ChatAgentVM[]; subagents: readonly ChatSubagentVM[]; pool: AgentOptionVM[];
  members: ChatMemberVM[]; labels: ChatTicketsLabels;
  visibility?: 'shared' | 'locked'; onSetVisibility?: (v: 'shared' | 'locked') => Promise<void>;
  onInviteAgent: (ref: string, kind: string) => Promise<void>; onRemoveAgent: (id: string) => Promise<void>;
  onInviteMember: (email: string) => Promise<void>; onRemoveMember: (id: number) => Promise<void>; busy: boolean;
}) {
  const [email, setEmail] = useState('');
  const submit = async () => {
    const e = email.trim();
    if (!e) return;
    await onInviteMember(e);
    setEmail('');
  };
  const locked = visibility === 'locked';
  const poolName = (ref: string) => pool.find((p) => p.ref === ref)?.name ?? ref;
  const uninvited = pool.filter((p) => !agents.some((a) => a.agentRef === p.ref));
  return (
    <div style={{ ...S.section, flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {agents.length + subagents.length === 0 ? <span style={S.muted}>{labels.noAgents}</span> : agents.map((a) => (
          <span key={a.id} style={S.agentChip}>
            <span aria-hidden>🤖</span>{poolName(a.agentRef)}
            <button type="button" title={labels.removeAgent} disabled={busy} onClick={() => void onRemoveAgent(a.id)} style={{ ...S.icon, fontSize: 11 }}>✕</button>
          </span>
        ))}
        {subagents.map((c) => (
          <span key={c.key} style={S.agentChip} title={c.label}>
            <span aria-hidden>🤖</span>{c.name}
            <span style={{ fontSize: 11, color: V.muted }}>{c.handle} · {labels.subagentOf.replace('{owner}', c.owner)}</span>
          </span>
        ))}
      </div>
      <select aria-label={labels.inviteAgent} value="" onChange={(e) => { const p = pool.find((x) => x.ref === e.target.value); if (p) void onInviteAgent(p.ref, p.kind); }} style={{ ...S.select, maxWidth: 260 }}>
        <option style={S.option} value="">{labels.inviteAgent}</option>
        {uninvited.map((p) => <option style={S.option} key={p.ref} value={p.ref}>{p.name} — {p.meta}</option>)}
      </select>
      <span style={{ fontSize: 11, ...S.muted }}>{labels.agentsHint}</span>

      {/* People — the human members of the same chat, one divider below the agents. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: `1px dashed ${V.border}`, paddingTop: 8, marginTop: 2 }}>
        <span style={{ fontSize: 10, color: V.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{labels.people}</span>
        {visibility && onSetVisibility && (
          <button type="button" disabled={busy} onClick={() => void onSetVisibility(locked ? 'shared' : 'locked')} style={S.pill(locked)}>
            {locked ? `🔒 ${labels.visibilityLocked}` : `🔓 ${labels.visibilityShared}`}
          </button>
        )}
        <span style={{ fontSize: 11, ...S.muted }}>{labels.lockHint}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {members.length === 0 ? <span style={S.muted}>{labels.noPeople}</span> : members.map((m) => (
          <span key={m.id} style={S.agentChip}>
            <span aria-hidden>{m.status === 'pending' ? '✉️' : '👤'}</span>{m.name}
            <button type="button" title={labels.removePerson} disabled={busy} onClick={() => void onRemoveMember(m.id)} style={{ ...S.icon, fontSize: 11 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="email" value={email} disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder={labels.invitePerson} aria-label={labels.invitePerson}
          style={{ ...S.select, flex: 1, maxWidth: 260 }}
        />
        <button type="button" disabled={busy || !email.trim()} onClick={() => void submit()} style={S.pill(false)}>＋</button>
      </div>
      <span style={{ fontSize: 11, ...S.muted }}>{labels.invitePersonHint}</span>
    </div>
  );
}

// Evidence re-verification: busts the verify cache (content-hash key) so the pre-push
// gate re-runs checks against the repaired install instead of replaying a stale record.
