'use client';

import type { PublishedAgent } from '@/lib/types';
import { formatAgentPrice } from '@/lib/agentPresentation';
import { isAgentOwner } from '@/lib/agentPermissions';
import { useAuth } from '@/lib/AuthContext';
import { AgentTypePill } from '@/components/AgentTypePill';
import { StatusBadge } from '@/components/StatusBadge';
import { SkillTags } from '@/components/SkillTags';
import { RUNTIME_LABELS } from './CloudAgentFormFields';
import { AgentOwnerActions } from './AgentOwnerActions';
import type { CloudAgentPanelTab } from './CloudAgentSlideOutPanel';

/**
 * The single, canonical card for a {@link PublishedAgent} — one layout for every
 * surface (the marketplace grid AND the /workforce directory). It carries the
 * full feature set: emoji + name/title, type pill, owner status badge, bio,
 * skills, runtime + price pills, hire count, and the action row.
 *
 * The card decides its OWN action set from the signed-in tenant + agent state —
 * callers never pass canEdit/canHire booleans:
 *
 *  - Owner (agent.tenant_id === my tenant)  → full management actions
 *                                             (publish / unpublish / edit price /
 *                                              edit / delete), wherever shown.
 *  - Non-owner on the marketplace           → Hire.
 *  - Non-owner in the workforce directory   → read-only (an agent I purchased).
 *
 * `context` only disambiguates the non-owner case (a hireable listing vs. an
 * agent I already acquired); ownership itself comes from auth.
 */

export type AgentCardContext = 'marketplace' | 'workforce';

const cardStyle: React.CSSProperties = {
  padding: 16, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden',
};

const runtimePillStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--accent)' };
const pricePillStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-strong)' };

export function AgentCard({
  agent,
  context = 'marketplace',
  onOpenPanel,
  onUnpublish,
  onDelete,
  onHire,
  hiring = false,
}: {
  agent: PublishedAgent;
  /** Which surface this card lives on — only affects the non-owner case. */
  context?: AgentCardContext;
  /** owner: open the slide-out panel on a given tab (edit / pricing). */
  onOpenPanel?: (agent: PublishedAgent, tab: CloudAgentPanelTab) => void;
  /** owner: unpublish in place. */
  onUnpublish?: (agent: PublishedAgent) => void;
  /** owner: delete (only offered when the agent is deletable). */
  onDelete?: (agent: PublishedAgent) => void;
  /** non-owner marketplace listing: hire this agent. */
  onHire?: (agentId: string) => void;
  hiring?: boolean;
}) {
  const { tenant } = useAuth();
  const owner = isAgentOwner(agent, tenant?.id);
  const subtitle = agent.title && agent.title !== agent.name ? agent.title : 'Workforce agent';

  return (
    <div className="card" style={cardStyle}>
      {/* Header: avatar + name/title, type pill + (owner) status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 24 }}>👤</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>{agent.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{subtitle}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <AgentTypePill kind={owner ? 'cloud' : 'marketplace'} label="Agent" />
          {owner && <StatusBadge variant={agent.published ? 'published' : 'draft'} />}
        </div>
      </div>

      {agent.bio && <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, flex: 1 }}>{agent.bio}</div>}

      <SkillTags skills={agent.skills} max={5} />

      {/* Runtime + price pills — pricing is shown on every card. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
        <span style={runtimePillStyle}>
          {RUNTIME_LABELS[agent.runtime_support ?? 'cloud']}
          {owner && agent.runtime_support === 'both' && agent.preferred_runtime ? ` · prefers ${agent.preferred_runtime}` : ''}
        </span>
        <span style={pricePillStyle}>{formatAgentPrice(agent)}</span>
      </div>

      {/* Footer: hire count + the action row (owner manage / hire / read-only). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {agent.hire_count != null ? `Hired ${agent.hire_count}×` : null}
          </div>
          {!owner && context === 'marketplace' && (
            <button type="button" className="btn btn-primary btn-sm" disabled={hiring} onClick={() => onHire?.(agent.id)}>
              {hiring ? 'Hiring…' : 'Hire'}
            </button>
          )}
        </div>
        {owner && (
          <AgentOwnerActions agent={agent} onOpenPanel={onOpenPanel} onUnpublish={onUnpublish} onDelete={onDelete} />
        )}
      </div>
    </div>
  );
}
