'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';
import { RolesView } from '@/components/workforce/RolesView';
import { TalentView } from '@/components/talent/TalentView';
import { TeamsView } from '@/components/teams/TeamsView';
import { ChatsView } from '@/components/chats/ChatsView';
import { HumanRequestsView } from '@/components/humanRequests/HumanRequestsView';
import { ObservabilityContent } from '@/components/ObservabilityContent';
import { PerformanceView } from '@/components/workforce/PerformanceView';
import { QaContent } from '@/components/QaContent';
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';
import { TeamChatButton } from '@/components/brain/TeamChatButton';
import { MeetingsCalendar } from '@/components/meetings/MeetingsCalendar';
import PageContainer from '@/components/PageContainer';

// Workforce sub-views are declared as query tabs in navGroups; the shell
// <SectionTabs> bar renders the tab bar. Here we just read `?tab=` to pick the
// body and the per-tab sub-label, mirroring the /quality surface.
type WorkforceTab = 'workforce' | 'roles' | 'teams' | 'calendar' | 'talent' | 'performance' | 'chats' | 'approvals' | 'logs' | 'qa';

const TAB_IDS: ReadonlyArray<WorkforceTab> = [
  'workforce', 'roles', 'teams', 'calendar', 'talent', 'performance', 'chats', 'approvals', 'logs', 'qa',
];

function WorkforcePageInner() {
  const t = useTranslations('workforce.page');
  const { tenant } = useAuth();
  const router = useRouter();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  const requested = useSearchParams().get('tab');
  // LLM Usage folded into the AI Insights hub; keep old ?tab=llm links working.
  useEffect(() => {
    if (requested === 'llm') router.replace('/insights/ai?panel=llm-usage');
  }, [requested, router]);

  // Contributors merged into Performance; keep old ?tab=contributors links working.
  const normalized = requested === 'contributors' ? 'performance' : requested;
  const tab: WorkforceTab = TAB_IDS.includes(normalized as WorkforceTab) ? (normalized as WorkforceTab) : 'workforce';

  return (
    <PageContainer>
      <div className="page-header" style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t('title')}</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>{t(`sub.${tab}`)}</p>
        </div>
        {/* Message the broader team — the tenant-wide team chat (humans + agents). */}
        <TeamChatButton variant="labeled" />
      </div>

      {tab === 'roles' ? (
        <RolesView />
      ) : tab === 'talent' ? (
        <TalentView />
      ) : tab === 'teams' ? (
        <TeamsView />
      ) : tab === 'calendar' ? (
        <MeetingsCalendar />
      ) : tab === 'performance' ? (
        <PerformanceView />
      ) : tab === 'chats' ? (
        <ChatsView />
      ) : tab === 'approvals' ? (
        <HumanRequestsView />
      ) : tab === 'logs' ? (
        <>
          {/* Live fleet view — what's running right now (self-hides when idle). */}
          <div style={{ marginBottom: 24 }}>
            <ActiveRunsPanel />
          </div>
          <ObservabilityContent initialView="logs" />
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
