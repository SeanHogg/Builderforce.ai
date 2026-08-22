/**
 * /workforce/plan — the blended human + agent workforce-planning surface.
 * Manager-gated (disabled, not hidden).
 *
 * A server component: the heading is translated server-side and the guard is the
 * shared `<RequireAuth>` client boundary, so only WorkforcePlanView and the gate
 * reach the client bundle.
 */
import { getTranslations } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { WorkforcePlanView } from '@/components/workforce/WorkforcePlanView';

// getTranslations reads the locale cookie, which makes the route per-request.
export const runtime = 'edge';

export default async function WorkforcePlanPage() {
  const t = await getTranslations('workforcePlan');

  return (
    <RequireAuth>
      <PageContainer>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{t('pageTitle')}</h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>{t('subtitle')}</p>
        </div>
        <RoleGate capability="insights.engineering" variant="block">
          <WorkforcePlanView />
        </RoleGate>
      </PageContainer>
    </RequireAuth>
  );
}
