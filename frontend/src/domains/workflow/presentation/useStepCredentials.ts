import { useCallback, useEffect, useRef, useState } from 'react';
import { integrationsApi, type IntegrationCredential } from '@/lib/builderforceApi';
import { faultMessage } from '@/lib/apiClient';
import { useConnectableCatalog, type ConnectableProvider } from '@/lib/connectableCatalog';
import { credentialsPayload, type CredentialDraft } from '@/components/integrations/credentialDraft';
import { isRunnableProvider } from '../domain/stepCredential';

/**
 * The tenant's stored credentials for ONE provider, plus the ability to add one.
 *
 * Reads and writes go through the existing `integrationsApi` (`/api/integrations`)
 * and the connect catalog — the same calls Settings ▸ Integrations makes. Only
 * enabled credentials are offered: a disabled one would fail at run time.
 */
export interface UseStepCredentials {
  credentials: IntegrationCredential[];
  loading: boolean;
  loadFailed: boolean;
  /** The connect-catalog descriptor for this provider; null = it cannot be connected here. */
  descriptor: ConnectableProvider | null;
  /** Whether the cloud runtime can execute this provider; null until the catalog has answered. */
  runnable: boolean | null;
  saving: boolean;
  saveError: string | null;
  /** Creates the credential and resolves to it, or null on failure (saveError is set). */
  create: (draft: CredentialDraft, fallbackError: string) => Promise<IntegrationCredential | null>;
}

export function useStepCredentials(provider: string): UseStepCredentials {
  const { byId, loading: catalogLoading, failed: catalogFailed } = useConnectableCatalog();
  const [credentials, setCredentials] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The provider whose response may still land. A slow answer for the PREVIOUS
  // provider must not overwrite the list the author is now looking at.
  const current = useRef(provider);
  current.current = provider;

  const load = useCallback(() => {
    const asked = provider;
    const live = () => current.current === asked;
    setLoading(true);
    setLoadFailed(false);
    return integrationsApi
      .list()
      .then((rows) => { if (live()) setCredentials(rows.filter((r) => r.provider === asked && r.isEnabled)); })
      .catch(() => { if (live()) setLoadFailed(true); })
      .finally(() => { if (live()) setLoading(false); });
  }, [provider]);

  useEffect(() => { void load(); }, [load]);

  const descriptor = byId.get(provider) ?? null;
  const runnable = catalogLoading || catalogFailed ? null : isRunnableProvider(descriptor);

  const create = useCallback(async (draft: CredentialDraft, fallbackError: string) => {
    if (!descriptor) return null;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await integrationsApi.create({
        provider: descriptor.id,
        name: draft.name.trim() || descriptor.label,
        baseUrl: descriptor.baseUrl === 'none' ? null : draft.baseUrl.trim() || null,
        projectId: null,
        credentials: credentialsPayload(descriptor, draft),
      });
      await load();
      return created;
    } catch (e) {
      setSaveError(faultMessage(e, fallbackError));
      return null;
    } finally {
      setSaving(false);
    }
  }, [descriptor, load]);

  return { credentials, loading, loadFailed, descriptor, runnable, saving, saveError, create };
}
