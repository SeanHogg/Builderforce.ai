'use client';

/**
 * /workforce/plan — the blended human + agent workforce-planning surface.
 * Standalone route (a new file) so it works without editing the shared workforce
 * page.tsx; the integration note carries the snippet to add it as a ?tab=plan tab.
 * Manager-gated (disabled, not hidden).
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { WorkforcePlanView } from '@/components/workforce/WorkforcePlanView';

export default function WorkforcePlanPage() {
  const t = useTranslations('workforcePlan');
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{t('pageTitle')}</h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>{t('subtitle')}</p>
      </div>
      <RoleGate capability="insights.engineering" variant="block">
        <WorkforcePlanView />
      </RoleGate>
    </PageContainer>
  );
}
