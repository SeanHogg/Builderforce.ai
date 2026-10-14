/**
 * Fix it's coding agent (PRD 33 §5.1.4): the agents that can take a Fix it task on
 * the site's project (`replayApi.listCodingAgents`). With none — an external site,
 * or a project with no coding agent — it says Fix it will create a ticket only,
 * rather than offering a choice that does nothing.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayCodingAgentChoiceDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';

export interface CodingAgentPickerProps {
  siteId: string;
  value: string | null;
  onChange: (agentRef: string | null) => void;
}

export function CodingAgentPicker({ siteId, value, onChange }: CodingAgentPickerProps) {
  const t = useTranslations('replay.prescription.agent');
  // null = not read yet.
  const [agents, setAgents] = useState<ReplayCodingAgentChoiceDto[] | null>(null);

  useEffect(() => {
    let live = true;
    replayApi.listCodingAgents(siteId)
      .then((found) => {
        if (!live) return;
        setAgents(found);
        // One agent: it is the choice.
        if (found.length === 1 && value === null) onChange(found[0]!.ref);
      })
      .catch(() => { if (live) setAgents([]); });
    return () => { live = false; };
    // Read once per site; `value`/`onChange` only seed the single-agent default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  if (agents === null) return null;
  if (agents.length === 0) {
    return <p data-testid="fix-ticket-only" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('none')}</p>;
  }
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-small)' }}>
      <span>{t('label')}</span>
      <select
        className="input"
        value={value ?? ''}
        onChange={(event) => onChange(event.currentTarget.value || null)}
        style={{ minHeight: 44, maxWidth: 220 }}
      >
        <option value="">{t('ticketOnly')}</option>
        {agents.map((agent) => <option key={agent.ref} value={agent.ref}>{agent.name}</option>)}
      </select>
    </label>
  );
}
