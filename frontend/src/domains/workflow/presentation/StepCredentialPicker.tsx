import { useTranslations } from 'next-intl';
import { CredentialKeyForm } from '@/components/integrations/CredentialKeyForm';
import { canManageIntegrations } from '@/components/integrations/canManageIntegrations';
import { getStoredTenant } from '@/lib/auth';
import type { IntegrationAuth } from '../domain/stepIntegrations';
import { StepConnectionSelect, type StepConnectionSource } from './StepConnectionSelect';
import { useStepCredentials } from './useStepCredentials';
import { hintStyle } from './stepFieldStyles';

/**
 * WHICH STORED CREDENTIAL AN INTEGRATION STEP RUNS WITH.
 *
 * Narrow contract: the stored provider id, its auth kind, the picked credential id
 * and one callback. It renders nothing for a step that needs no credential, says so
 * plainly when the cloud runtime cannot run the provider yet, and otherwise adapts
 * the integration credential vault to the shared `StepConnectionSelect`. "Connect
 * new" is the SAME `CredentialKeyForm` Settings ▸ Integrations uses. The secret is
 * sealed server-side and never comes back; the step keeps only the credential's id.
 */
export interface StepCredentialPickerProps {
  /** Stored provider id (snake_case), e.g. `hubspot`. */
  provider: string;
  auth: IntegrationAuth;
  /** The picked credential id; '' = automatic. */
  value: string;
  onChange: (credentialId: string) => void;
}

export function StepCredentialPicker({ provider, auth, value, onChange }: StepCredentialPickerProps) {
  const t = useTranslations('workflow.credentials');
  const { credentials, loading, loadFailed, descriptor, runnable, saving, saveError, create } = useStepCredentials(provider);

  if (auth === 'none') return null;
  // Not a dead "connect one" hint: no connection can make this step run yet.
  if (runnable === false) {
    return (
      <div role="note" style={hintStyle}>
        <strong>{t('notRunnable')}</strong> {t('notRunnableHint')}
      </div>
    );
  }

  const canConnect = descriptor != null && canManageIntegrations(getStoredTenant()?.role);
  const source: StepConnectionSource = {
    options: credentials.map((c) => ({ id: c.id, name: c.name })),
    loading,
    loadFailed,
    connect: canConnect
      ? (done, cancel) => (
        <CredentialKeyForm
          providers={[descriptor]}
          editing={null}
          saving={saving}
          serverError={saveError}
          onCancel={cancel}
          onSave={(draft) => {
            void create(draft, t('saveFailed')).then((created) => { if (created) done(created.id); });
          }}
        />
      )
      : null,
  };

  return <StepConnectionSelect source={source} value={value} onChange={onChange} />;
}
