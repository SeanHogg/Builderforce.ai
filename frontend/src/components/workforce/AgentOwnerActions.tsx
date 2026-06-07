'use client';

import type { PublishedAgent } from '@/lib/types';
import { canDeleteAgent } from '@/lib/agentPermissions';
import { btnPrimary, btnSubtle } from './CloudAgentFormFields';
import type { CloudAgentPanelTab } from './CloudAgentSlideOutPanel';

/**
 * The publish / unpublish / edit-price / edit / delete action row for an agent
 * the tenant OWNS. Shared by the workforce {@link AgentCard} (card grid) and the
 * workforce list/table view so the action set + delete-gating live in one place.
 *
 * `includeEditPrice` is on for the card (which has room for it) and off for the
 * compact table row, matching the existing layouts.
 */
export function AgentOwnerActions({
  agent,
  onOpenPanel,
  onUnpublish,
  onDelete,
  includeEditPrice = true,
}: {
  agent: PublishedAgent;
  onOpenPanel?: (agent: PublishedAgent, tab: CloudAgentPanelTab) => void;
  onUnpublish?: (agent: PublishedAgent) => void;
  onDelete?: (agent: PublishedAgent) => void;
  includeEditPrice?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {agent.published
        ? <button type="button" style={btnSubtle} onClick={() => onUnpublish?.(agent)}>Unpublish</button>
        : <button type="button" style={btnPrimary} onClick={() => onOpenPanel?.(agent, 'pricing')}>Publish</button>}
      {includeEditPrice && agent.published && (
        <button type="button" style={btnSubtle} onClick={() => onOpenPanel?.(agent, 'pricing')}>Edit price</button>
      )}
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
  );
}
