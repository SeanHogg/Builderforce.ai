'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { EmulationLauncherProvider } from '@/components/admin/EmulationLauncher';
import AdminGroupNav from '@/components/admin/AdminGroupNav';
import { resolveAdminRoute } from '@/lib/adminGroups';
import { TenantApiKeysAdminTab } from '@/components/admin/TenantApiKeysAdminTab';
import { LlmTracesPanel } from './LlmTracesPanel';
import HealthPanel from '@/components/admin/panels/HealthPanel';
import BillingPanel from '@/components/admin/panels/BillingPanel';
import UsagePanel from '@/components/admin/panels/UsagePanel';
import UsersPanel from '@/components/admin/panels/UsersPanel';
import GuestSessionsPanel from '@/components/admin/panels/GuestSessionsPanel';
import TenantsPanel from '@/components/admin/panels/TenantsPanel';
import SecurityPanel from '@/components/admin/panels/SecurityPanel';
import LegalPanel from '@/components/admin/panels/LegalPanel';
import NewsletterPanel from '@/components/admin/panels/NewsletterPanel';
import ReleaseNotesPanel from '@/components/admin/panels/ReleaseNotesPanel';
import DemoFunnelPanel from '@/components/admin/panels/DemoFunnelPanel';
import SalesLeadsPanel from '@/components/admin/panels/SalesLeadsPanel';
import PrivacyPanel from '@/components/admin/panels/PrivacyPanel';
import PersonasPanel from '@/components/admin/panels/PersonasPanel';
import GovernancePanel from '@/components/admin/panels/GovernancePanel';
import PermissionsPanel from '@/components/admin/panels/PermissionsPanel';
import ModulesPanel from '@/components/admin/panels/ModulesPanel';
import ImpersonationSessionsPanel from '@/components/admin/panels/ImpersonationSessionsPanel';
import AuditLogPanel from '@/components/admin/panels/AuditLogPanel';
import ErrorsPanel from '@/components/admin/panels/ErrorsPanel';
import TokenPanel from '@/components/admin/panels/TokenPanel';
import FeedbackPanel from '@/components/admin/panels/FeedbackPanel';

/**
 * Platform Admin shell — a THIN router.
 *
 * The 19 admin capabilities are consolidated into 10 top-level GROUPS (see
 * `ADMIN_GROUP_META`); each group's sub-views are the shared shell <SectionTabs>
 * bar's tabs, and within a group an inner <AdminGroupNav> switches sub-views via
 * `?sub=`. This page owns no state: it resolves `?tab=`/`?sub=` to a group + sub
 * and renders the matching self-fetching panel (`components/admin/panels/*`).
 */

// subKey → its panel. subKeys are globally unique across all groups (see
// ADMIN_GROUP_META), so one flat registry covers every sub-view.
const ADMIN_PANELS: Record<string, () => React.JSX.Element> = {
  health: HealthPanel,
  directory: UsersPanel,
  sessions: GuestSessionsPanel,
  security: SecurityPanel,
  emulation: ImpersonationSessionsPanel,
  tenants: TenantsPanel,
  permissions: PermissionsPanel,
  modules: ModulesPanel,
  usage: UsagePanel,
  traces: LlmTracesPanel,
  personas: PersonasPanel,
  governance: GovernancePanel,
  legal: LegalPanel,
  privacy: PrivacyPanel,
  billing: BillingPanel,
  newsletter: NewsletterPanel,
  releaseNotes: ReleaseNotesPanel,
  demoFunnel: DemoFunnelPanel,
  salesLeads: SalesLeadsPanel,
  errors: ErrorsPanel,
  audit: AuditLogPanel,
  apiKeys: () => <TenantApiKeysAdminTab active />,
  token: TokenPanel,
  feedback: FeedbackPanel,
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

  const { group, sub } = resolveAdminRoute(searchParams?.get('tab') ?? '', searchParams?.get('sub') ?? '');
  const Panel = ADMIN_PANELS[sub.subKey] ?? HealthPanel;

  return (
    <PageContainer>
      {/* `.admin-page` remains the styling context: several CSS rules are scoped
          under it (.admin-page .health-grid / .badge / .btn-ghost / .admin-select
          / .admin-token-*), so the extracted panels inherit the same look. */}
      <div className="admin-page">
        {/* One provider owns the emulate flow so Users / Tenants / the user drawer
            can launch it without prop-drilling a callback + modal state. */}
        <EmulationLauncherProvider>
          <AdminGroupNav group={group} activeSubId={sub.id} />
          <Panel />
        </EmulationLauncherProvider>
      </div>
    </PageContainer>
  );
}
