'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';
import { TeamsView } from '@/components/teams/TeamsView';
import { ContributorsView } from '@/components/contributors/ContributorsView';
import { ChatsView } from '@/components/chats/ChatsView';
import { HumanRequestsView } from '@/components/humanRequests/HumanRequestsView';
import { ObservabilityContent } from '@/components/ObservabilityContent';
import { WorkforceMetricsContent } from '@/components/workforce/WorkforceMetricsContent';
import { LlmUsageContent } from '@/components/LlmUsageContent';
import { ModelRoutingAnalytics } from '@/components/ModelRoutingAnalytics';
import { QaContent } from '@/components/QaContent';
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';
import PageContainer from '@/components/PageContainer';

// Workforce sub-views are declared as query tabs in navGroups; the shell
// <SectionTabs> bar renders the tab bar. Here we just read `?tab=` to pick the
// body and the per-tab sub-label, mirroring the /quality surface.
type WorkforceTab = 'workforce' | 'teams' | 'performance' | 'chats' | 'approvals' | 'contributors' | 'logs' | 'llm' | 'qa';

const TAB_IDS: ReadonlyArray<WorkforceTab> = [
  'workforce', 'teams', 'performance', 'chats', 'approvals', 'contributors', 'logs', 'llm', 'qa',
];

function WorkforcePageInner() {
  const t = useTranslations('workforce.page');
  const { tenant } = useAuth();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  const requested = useSearchParams().get('tab');
  const tab: WorkforceTab = TAB_IDS.includes(requested as WorkforceTab) ? (requested as WorkforceTab) : 'workforce';

  return (
    <PageContainer>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t('title')}</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>{t(`sub.${tab}`)}</p>
        </div>
      </div>

      {tab === 'teams' ? (
        <TeamsView />
      ) : tab === 'performance' ? (
        <WorkforceMetricsContent />
      ) : tab === 'chats' ? (
        <ChatsView />
      ) : tab === 'approvals' ? (
        <HumanRequestsView />
      ) : tab === 'contributors' ? (
        <ContributorsView />
      ) : tab === 'logs' ? (
        <>
          {/* Live fleet view — what's running right now (self-hides when idle). */}
          <div style={{ marginBottom: 24 }}>
            <ActiveRunsPanel />
          </div>
          <ObservabilityContent initialView="logs" />
        </>
      ) : tab === 'llm' ? (
        <>
          <LlmUsageContent />
          <ModelRoutingAnalytics />
        </>
      ) : tab === 'qa' ? (
        <QaContent />
      ) : (
        <WorkforceAgents tenantId={tenantId} />
      )}
    </PageContainer>
  );
}

export default function WorkforcePage() {
  // useSearchParams requires a Suspense boundary under the App Router.
  return (
    <Suspense fallback={null}>
      <WorkforcePageInner />
    </Suspense>
  );
}
