'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';
import { ContributorsView } from '@/components/contributors/ContributorsView';
import { MembersView } from '@/components/members/MembersView';
import { ChatsView } from '@/components/chats/ChatsView';
import { HumanRequestsView } from '@/components/humanRequests/HumanRequestsView';
import { ObservabilityContent } from '@/components/ObservabilityContent';
import { LlmUsageContent } from '@/components/LlmUsageContent';
import { QaContent } from '@/components/QaContent';
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';
import { Tabs } from '@/components/Tabs';
import PageContainer from '@/components/PageContainer';

type WorkforceTab = 'workforce' | 'chats' | 'approvals' | 'contributors' | 'members' | 'logs' | 'llm' | 'qa';

const TABS: ReadonlyArray<{ id: WorkforceTab; label: string; sub: string }> = [
  {
    id: 'workforce',
    label: 'Workforce',
    sub: 'Create cloud agents, register remote agents, and connect them to your workspace. Publish agents to the marketplace to earn revenue.',
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
    id: 'members',
    label: 'Members',
    sub: 'Invite teammates and manage who has access to your workspace.',
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
        <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>Workforce</h1>
        <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{active.sub}</p>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'chats' ? (
        <ChatsView />
      ) : tab === 'approvals' ? (
        <HumanRequestsView />
      ) : tab === 'contributors' ? (
        <ContributorsView />
      ) : tab === 'members' ? (
        <MembersView />
      ) : tab === 'logs' ? (
        <>
          {/* Live fleet view — what's running right now (self-hides when idle). */}
          <div style={{ marginBottom: 24 }}>
            <ActiveRunsPanel />
          </div>
          <ObservabilityContent initialView="logs" />
        </>
      ) : tab === 'llm' ? (
        <LlmUsageContent />
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
