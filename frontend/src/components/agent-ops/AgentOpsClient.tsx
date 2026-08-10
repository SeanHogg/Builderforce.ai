'use client';

import { useTranslations } from 'next-intl';
import { CoordinationPanel } from './CoordinationPanel';
import { MemoryPanel } from './MemoryPanel';
import { RehearsalPanel } from './RehearsalPanel';

export type AgentOpsTab = 'coordination' | 'memory' | 'rehearsal';

export function AgentOpsContent({ tab }: { tab: AgentOpsTab }) {
  const t = useTranslations('agentOps');
  const section =
    tab === 'memory'
      ? { heading: t('memory.title'), body: <MemoryPanel /> }
      : tab === 'rehearsal'
        ? { heading: t('rehearsal.title'), body: <RehearsalPanel /> }
        : { heading: t('coordination.title'), body: <CoordinationPanel /> };

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{section.heading}</h2>
      </div>
      {section.body}
    </>
  );
}
