'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { EmulationLauncherProvider } from '@/components/admin/EmulationLauncher';
import { TenantApiKeysAdminTab } from '@/components/admin/TenantApiKeysAdminTab';
import { LlmTracesPanel } from './LlmTracesPanel';
import HealthPanel from '@/components/admin/panels/HealthPanel';
import BillingPanel from '@/components/admin/panels/BillingPanel';
import UsagePanel from '@/components/admin/panels/UsagePanel';
import UsersPanel from '@/components/admin/panels/UsersPanel';
import TenantsPanel from '@/components/admin/panels/TenantsPanel';
import SecurityPanel from '@/components/admin/panels/SecurityPanel';
import LegalPanel from '@/components/admin/panels/LegalPanel';
import NewsletterPanel from '@/components/admin/panels/NewsletterPanel';
import PrivacyPanel from '@/components/admin/panels/PrivacyPanel';
import PersonasPanel from '@/components/admin/panels/PersonasPanel';
import GovernancePanel from '@/components/admin/panels/GovernancePanel';
import PermissionsPanel from '@/components/admin/panels/PermissionsPanel';
import ModulesPanel from '@/components/admin/panels/ModulesPanel';
import ImpersonationSessionsPanel from '@/components/admin/panels/ImpersonationSessionsPanel';
import AuditLogPanel from '@/components/admin/panels/AuditLogPanel';
import ErrorsPanel from '@/components/admin/panels/ErrorsPanel';
import TokenPanel from '@/components/admin/panels/TokenPanel';

/**
 * Platform Admin shell — now a THIN router.
 *
 * The 19 admin sub-views are TABS in the shared shell <SectionTabs> bar (see the
 * `admin` group in navGroups) — this page no longer renders an in-page tab strip
 * or a 3.5k-line god component. It reads the active tab from `?tab=` (the shell
 * bar owns navigation) and renders the matching self-fetching panel. Each panel
 * (`components/admin/panels/*`) loads its own data and manages its own
 * loading/error, so there is no shared state to thread through here.
 */

// `?tab=` value → its panel. Default (Health) is the empty id so a bare /admin
// resolves to it (matching the nav group's default tab).
const PANELS: Record<string, () => React.JSX.Element> = {
  '': HealthPanel,
  health: HealthPanel,
  billing: BillingPanel,
  usage: UsagePanel,
  users: UsersPanel,
  tenants: TenantsPanel,
  apikeys: () => <TenantApiKeysAdminTab active />,
  security: SecurityPanel,
  legal: LegalPanel,
  newsletter: NewsletterPanel,
  privacy: PrivacyPanel,
  personas: PersonasPanel,
  governance: GovernancePanel,
  permissions: PermissionsPanel,
  modules: ModulesPanel,
  impsessions: ImpersonationSessionsPanel,
  auditlog: AuditLogPanel,
  errors: ErrorsPanel,
  traces: LlmTracesPanel,
  token: TokenPanel,
};

export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const isSuperadmin = Boolean(user?.isSuperadmin);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/admin');
      return;
    }
    if (isAuthenticated && !isSuperadmin) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isSuperadmin, router]);

  if (!isAuthenticated || !isSuperadmin) return null;

  const Panel = PANELS[searchParams?.get('tab') ?? ''] ?? HealthPanel;

  return (
    <PageContainer>
      {/* `.admin-page` remains the styling context: several CSS rules are scoped
          under it (.admin-page .health-grid / .badge / .btn-ghost / .admin-select
          / .admin-token-*), so the extracted panels inherit the same look. */}
      <div className="admin-page">
        {/* One provider owns the emulate flow so Users / Tenants / the user drawer
            can launch it without prop-drilling a callback + modal state. */}
        <EmulationLauncherProvider>
          <Panel />
        </EmulationLauncherProvider>
      </div>
    </PageContainer>
  );
}
