'use client';

import type { PublishedAgent } from '@/lib/types';
import { canDeleteAgent } from '@/lib/agentPermissions';
import { formatAgentPrice } from '@/lib/agentPresentation';
import { AgentTypePill } from '@/components/AgentTypePill';
import { StatusBadge } from '@/components/StatusBadge';
import { SkillTags } from '@/components/SkillTags';
import { RUNTIME_LABELS, btnPrimary, btnSubtle } from './CloudAgentFormFields';
import type { CloudAgentPanelTab } from './CloudAgentSlideOutPanel';

/**
 * The single card for a {@link PublishedAgent}, rendered three ways:
 *
 * - `owned`       — a cloud agent this tenant owns. Full management actions.
 * - `purchased`   — an agent acquired from the marketplace. Read-only.
 * - `marketplace` — a hireable listing in the public marketplace grid.
 *
 * Previously this markup (and the price/badge/skill/pill logic inside it) was
 * duplicated across WorkforceAgents (three loops) and the marketplace page. The
 * card owns its own action visibility from `variant` + agent state — callers do
 * not pass `canEdit`/`canDelete` booleans.
 */

export type AgentCardVariant = 'owned' | 'purchased' | 'marketplace';

const cardStyle: React.CSSProperties = {
  padding: 16, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden',
};

const runtimePillStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--accent)' };
const pricePillStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-strong)' };

export function AgentCard({
  agent,
  variant,
  onOpenPanel,
  onUnpublish,
  onDelete,
  onHire,
  hiring = false,
}: {
  agent: PublishedAgent;
  variant: AgentCardVariant;
  /** owned: open the slide-out panel on a given tab (edit / pricing). */
  onOpenPanel?: (agent: PublishedAgent, tab: CloudAgentPanelTab) => void;
  /** owned: unpublish in place. */
  onUnpublish?: (agent: PublishedAgent) => void;
  /** owned: delete (only offered when the agent is deletable). */
  onDelete?: (agent: PublishedAgent) => void;
  /** marketplace: hire this agent. */
  onHire?: (agentId: string) => void;
  hiring?: boolean;
}) {
  const showTitle = agent.title && agent.title !== agent.name;

  // --- Marketplace listing -------------------------------------------------
  if (variant === 'marketplace') {
    return (
      <div className="card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 24 }}>👤</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>{agent.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{agent.title || 'Workforce agent'}</div>
            </div>
          </div>
          <AgentTypePill kind="marketplace" label="Agent" />
        </div>
        {agent.bio && <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, flex: 1 }}>{agent.bio}</div>}
        <SkillTags skills={agent.skills} max={5} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {agent.hire_count != null ? `Hired ${agent.hire_count}×` : null}
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={hiring} onClick={() => onHire?.(agent.id)}>
            {hiring ? 'Hiring…' : 'Hire'}
          </button>
        </div>
      </div>
    );
  }

  // --- Owned + purchased (workforce directory) -----------------------------
  const purchased = variant === 'purchased';
  return (
    <div className="card" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>{agent.name}</span>
        {purchased ? <AgentTypePill kind="marketplace" /> : <AgentTypePill kind="cloud" />}
        {!purchased && <StatusBadge variant={agent.published ? 'published' : 'draft'} />}
      </div>
      {showTitle && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{agent.title}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
        <span style={runtimePillStyle}>
          {RUNTIME_LABELS[agent.runtime_support ?? 'cloud']}
          {!purchased && agent.runtime_support === 'both' && agent.preferred_runtime ? ` · prefers ${agent.preferred_runtime}` : ''}
        </span>
        <span style={pricePillStyle}>{formatAgentPrice(agent)}</span>
      </div>
      {!purchased && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {agent.published
            ? <button type="button" style={btnSubtle} onClick={() => onUnpublish?.(agent)}>Unpublish</button>
            : <button type="button" style={btnPrimary} onClick={() => onOpenPanel?.(agent, 'pricing')}>Publish</button>}
          {agent.published && <button type="button" style={btnSubtle} onClick={() => onOpenPanel?.(agent, 'pricing')}>Edit price</button>}
          <button type="button" style={btnSubtle} onClick={() => onOpenPanel?.(agent, 'details')}>Edit</button>
          {canDeleteAgent(agent) && (
            <button
              type="button"
              style={{ ...btnSubtle, color: 'var(--danger, #dc2626)', borderColor: 'rgba(239,68,68,0.3)' }}
              onClick={() => onDelete?.(agent)}
              title="Delete this draft agent (only available while unpublished and unpurchased)"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
