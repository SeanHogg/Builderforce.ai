'use client';

import { useTranslations } from 'next-intl';
import type { PublishedAgent } from '@/lib/types';
import { formatAgentPrice } from '@/lib/agentPresentation';
import { isAgentOwner } from '@/lib/agentPermissions';
import { useAuth } from '@/lib/AuthContext';
import { StatusBadge } from '@/components/StatusBadge';
import { BuiltinKindBadge } from '@/components/BuiltinKindBadge';
import { SkillTags } from '@/components/SkillTags';
import PersonalitySummary from '@/components/PersonalitySummary';
import { WorkforceCard } from './WorkforceCard';
import { RUNTIME_LABELS } from './CloudAgentFormFields';
import { AgentOwnerActions } from './AgentOwnerActions';
import { AgentManifestSection } from './AgentManifestSection';
import type { AgentManifest } from '@/lib/builderforceApi';
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
 *  - Non-owner + already hired              → Unhire (release it).
 *  - Non-owner + not hired                  → Hire.
 *
 * `hired` is the only fact the card can't derive from `agent` + auth alone (it
 * depends on the tenant's purchase set), so the caller supplies it; the
 * Hire/Unhire branch itself lives only here. On the /workforce purchased list it
 * is always true; on the marketplace it is membership in the purchased set.
 */

const runtimePillStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--accent)' };
const pricePillStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-strong)' };
const evalPillStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: 6, background: 'rgba(34,197,94,0.12)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)' };

/** Public eval score (0-1) for an agent, preferring the camelCase contract field
 *  and falling back to the snake_case row column. null when not yet scored. */
function agentEvalScore(agent: PublishedAgent): number | null {
  const raw = agent.evalScore ?? agent.eval_score;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function AgentCard({
  agent,
  manifest,
  hired = false,
  onOpenPanel,
  onUnpublish,
  onDelete,
  onHire,
  hiring = false,
  onUnhire,
  unhiring = false,
}: {
  agent: PublishedAgent;
  /** The agent's assigned-capability manifest (skills/personas/content). Owners
   *  always see the section (empty included); others only when one is provided. */
  manifest?: AgentManifest;
  /** Has the current tenant already hired this agent? Drives Hire vs Unhire. */
  hired?: boolean;
  /** owner: open the slide-out panel on a given tab (edit / pricing). */
  onOpenPanel?: (agent: PublishedAgent, tab: CloudAgentPanelTab) => void;
  /** owner: unpublish in place. */
  onUnpublish?: (agent: PublishedAgent) => void;
  /** owner: delete (only offered when the agent is deletable). */
  onDelete?: (agent: PublishedAgent) => void;
  /** non-owner, not yet hired: hire this agent. */
  onHire?: (agentId: string) => void;
  hiring?: boolean;
  /** non-owner, already hired: release it. */
  onUnhire?: (agentId: string) => void;
  unhiring?: boolean;
}) {
  const { tenant } = useAuth();
  const t = useTranslations('marketplace');
  const owner = isAgentOwner(agent, tenant?.id);
  const subtitle = agent.title && agent.title !== agent.name ? agent.title : t('action.workforceAgent');
  const evalScore = agentEvalScore(agent);

  return (
    <WorkforceCard
      avatar={<span style={{ fontSize: 24 }}>🤖</span>}
      name={agent.name}
      subtitle={subtitle}
      pill={{ kind: owner ? 'cloud' : 'marketplace', label: t('card.agentPill') }}
      badges={
        <>
          {/* Type indicator for built-in agents — stays visible next to whatever
              name the team renamed the agent to. Renders null for ordinary agents. */}
          <BuiltinKindBadge kind={agent.builtin_kind} />
          {owner ? <StatusBadge variant={agent.published ? 'published' : 'draft'} /> : null}
        </>
      }
      body={
        <>
          {agent.bio && <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, flex: 1 }}>{agent.bio}</div>}
          <SkillTags skills={agent.skills} max={5} />
          {/* This agent's personality — same read-only readout the human MemberCard
              shows; self-hides when the agent carries no personality. */}
          <PersonalitySummary profile={agent.psychometric ?? undefined} />
          {/* Runtime + price pills — pricing is shown on every card. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
            <span style={runtimePillStyle}>
              {RUNTIME_LABELS[agent.runtime_support ?? 'cloud']}
              {owner && agent.runtime_support === 'both' && agent.preferred_runtime ? ` · ${t('card.prefers', { runtime: agent.preferred_runtime })}` : ''}
            </span>
            <span style={pricePillStyle}>{formatAgentPrice(agent)}</span>
            {evalScore != null && (
              <span style={evalPillStyle} title={t('card.evalTitle')}>{t('card.eval', { score: evalScore.toFixed(2) })}</span>
            )}
          </div>
          {/* Assigned configuration + Copy manifest — on every agent card (an empty
              section is the "nothing configured" signal), consistent with the list
              view's Configuration column. */}
          <AgentManifestSection agent={agent} manifest={manifest} />
        </>
      }
      footer={
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {agent.hire_count != null ? t('card.hired', { count: agent.hire_count }) : null}
              {/* "In use" (active holders) is an owner-only signal — never shown to
                  non-owners, who can't see how/whether others are using it. */}
              {owner && agent.active_hires != null ? ` · ${t('card.inUse', { count: agent.active_hires })}` : null}
            </div>
            {!owner && (hired ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={unhiring} onClick={() => onUnhire?.(agent.id)}>
                {unhiring ? t('action.unhiring') : t('action.unhire')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" disabled={hiring} onClick={() => onHire?.(agent.id)}>
                {hiring ? t('action.hiring') : t('action.hire')}
              </button>
            ))}
          </div>
          {owner && (
            <AgentOwnerActions agent={agent} onOpenPanel={onOpenPanel} onUnpublish={onUnpublish} onDelete={onDelete} />
          )}
        </>
      }
    />
  );
}
