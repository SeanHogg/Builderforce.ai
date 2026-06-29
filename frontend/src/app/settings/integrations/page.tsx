'use client';

import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { IntegrationCredentialsManager } from '@/components/integrations/IntegrationCredentialsManager';
import { EmbedIntegrationSettings } from '@/components/settings/EmbedIntegrationSettings';

/**
 * Integrations tab of Settings. Hosts the workspace-global source-control /
 * external-tool credentials and the embedded-integration config — both moved
 * here off the General settings page so the app's many integrations have a
 * dedicated home in the settings nav. Each child self-gates to owner/manager.
 */
export default function SettingsIntegrationsPage() {
  const t = useTranslations('settings');

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          {t('integrationsTitle')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('integrationsSubtitle')}
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <IntegrationCredentialsManager heading={t('sourceControlKeys')} />
      </div>

      <div>
        <EmbedIntegrationSettings />
      </div>
    </PageContainer>
  );
}
