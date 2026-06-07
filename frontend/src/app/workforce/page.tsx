'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';
import { ContributorsView } from '@/components/contributors/ContributorsView';
import { MembersView } from '@/components/members/MembersView';

type WorkforceTab = 'workforce' | 'contributors' | 'members';

const TABS: ReadonlyArray<{ id: WorkforceTab; label: string; sub: string }> = [
  {
    id: 'workforce',
    label: 'Workforce',
    sub: 'Create cloud agents, register remote agents, and connect them to your workspace. Publish agents to the marketplace to earn revenue.',
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
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>Workforce</h1>
        <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{active.sub}</p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: `2px solid ${tab === t.id ? 'var(--coral-bright, #f4726e)' : 'transparent'}`,
              color: tab === t.id ? 'var(--coral-bright, #f4726e)' : 'var(--text-muted)',
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'contributors' ? <ContributorsView /> : tab === 'members' ? <MembersView /> : <WorkforceAgents tenantId={tenantId} />}
    </div>
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
