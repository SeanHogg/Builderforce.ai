'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { CoordinationPanel } from './CoordinationPanel';
import { MemoryPanel } from './MemoryPanel';
import { RehearsalPanel } from './RehearsalPanel';

/**
 * Agent Ops shell — one destination for the three things you do to an agent FLEET
 * rather than to an agent:
 *
 *   Coordination — who holds which files right now, and the notes concurrent agents
 *                  are leaving each other on a ticket.
 *   Memory       — every remembered fact with its scope, provenance and expiry.
 *   Rehearsal    — run an agent for real with every effect suppressed, and read what
 *                  it WOULD have done.
 *
 * The tab bar is rendered globally from `navGroups` (kind:'query'), so this shell only
 * reads `?tab=` to pick a body — the same contract as /quality and /incidents.
 */
export default function AgentOpsClient() {
  const t = useTranslations('agentOps');
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const tab = useSearchParams().get('tab') ?? '';

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  const section =
    tab === 'memory'
      ? { heading: t('memory.title'), sub: t('memory.subtitle'), body: <MemoryPanel /> }
      : tab === 'rehearsal'
        ? { heading: t('rehearsal.title'), sub: t('rehearsal.subtitle'), body: <RehearsalPanel /> }
        : { heading: t('coordination.title'), sub: t('coordination.subtitle'), body: <CoordinationPanel /> };

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{section.heading}</h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4, maxWidth: '68ch' }}>{section.sub}</p>
      </div>
      {section.body}
    </PageContainer>
  );
}
