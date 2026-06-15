'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Tabs } from '@/components/Tabs';
import PageContainer from '@/components/PageContainer';

type WorkforceTab = 'workforce' | 'teams' | 'performance' | 'chats' | 'approvals' | 'contributors' | 'logs' | 'llm' | 'qa';

const TABS: ReadonlyArray<{ id: WorkforceTab; label: string; sub: string }> = [
  {
    id: 'workforce',
    label: 'Workforce',
    sub: 'Your people and agents in one place — invite teammates, create cloud agents, and register remote agents. Publish agents to the marketplace to earn revenue.',
  },
  {
    id: 'teams',
    label: 'Teams',
    sub: 'Group your workforce — agents and humans — into teams, and attach a team to the projects it works on.',
  },
  {
    id: 'performance',
    label: 'Performance',
    sub: 'Effectiveness & engagement scorecards for every member — human and agent — plus DORA metrics. Click a member to set their capability & availability profile (what the sprint planner uses to assign work).',
  },
  {
    id: 'chats',
    label: 'Chats',
    sub: 'Browse chat sessions across every agentHost in this workspace.',
  },
  {
    id: 'approvals',
    label: 'Approvals & Q&A',
    sub: 'Resolve approvals, questions, and feedback your agents escalate for a human — sign off on actions or answer what they need to proceed.',
  },
  {
    id: 'contributors',
    label: 'Contributors',
    sub: 'See who — human and agent — is contributing across your workspace, and how.',
  },
  {
    id: 'logs',
    label: 'Logs',
    sub: 'Agent logs, execution timelines, and diagnostics across your workspace.',
  },
  {
    id: 'llm',
    label: 'LLM Usage',
    sub: 'LLM usage metrics, model health, and spend across your workspace.',
  },
  {
    id: 'qa',
    label: 'Agentic QA',
    sub: 'Per-project QA automation — flows, generated tests, and CI runs.',
  },
];

function WorkforcePageInner() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: WorkforceTab = TABS.some((t) => t.id === requested) ? (requested as WorkforceTab) : 'workforce';
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  // Workforce is the default tab, so it lives at the bare /workforce URL; other
  // tabs carry an explicit ?tab= so they're linkable and survive a refresh.
  const setTab = (next: WorkforceTab) => {
    router.replace(next === 'workforce' ? '/workforce' : `/workforce?tab=${next}`, { scroll: false });
  };

  return (
    <PageContainer>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Workforce</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>{active.sub}</p>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

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
