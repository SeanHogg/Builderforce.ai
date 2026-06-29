'use client';

import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { IntegrationsGallery } from '@/components/integrations/IntegrationsGallery';
import { EmbedIntegrationSettings } from '@/components/settings/EmbedIntegrationSettings';

/**
 * Integrations tab of Settings. The gallery is the workspace-level home for every
 * external system: connect a provider, configure credentials, view connections +
 * activity/diagnostics, and launch the migration wizard (Jira/Monday/Rally/GitLab/
 * Bitbucket → BuilderForce). The embedded-integration config sits below. Each
 * child self-gates to owner/manager.
 */
export default function SettingsIntegrationsPage() {
  const t = useTranslations('settings');

  return (
    <PageContainer width="full" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          {t('integrationsTitle')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('integrationsSubtitle')}
        </p>
      </div>

      <div style={{ marginBottom: 24 }}>
        <IntegrationsGallery />
      </div>

      <div>
        <EmbedIntegrationSettings />
      </div>
    </PageContainer>
  );
}
