import { useCallback, useEffect, useState } from 'react';
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

interface Settled {
  /** The provider and reload count this answer belongs to; an answer for any other is not current. */
  provider: string;
  attempt: number;
  credentials: IntegrationCredential[];
  failed: boolean;
}

export function useStepCredentials(provider: string): UseStepCredentials {
  const { byId, loading: catalogLoading, failed: catalogFailed } = useConnectableCatalog();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // A slow answer for the PREVIOUS provider must not overwrite the list the author is now looking at.
    let live = true;
    integrationsApi
      .list()
      .then(
        (rows) => ({ credentials: rows.filter((r) => r.provider === provider && r.isEnabled), failed: false }),
        () => ({ credentials: [] as IntegrationCredential[], failed: true }),
      )
      .then((outcome) => { if (live) setSettled({ provider, attempt, ...outcome }); });
    return () => { live = false; };
  }, [provider, attempt]);

  const current = settled?.provider === provider && settled.attempt === attempt ? settled : null;
  const forProvider = settled?.provider === provider ? settled : null;

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
      setAttempt((count) => count + 1); // re-read the list so the new credential appears
      return created;
    } catch (e) {
      setSaveError(faultMessage(e, fallbackError));
      return null;
    } finally {
      setSaving(false);
    }
  }, [descriptor]);

  return {
    credentials: forProvider?.credentials ?? [],
    loading: current === null,
    loadFailed: current?.failed ?? false,
    descriptor,
    runnable,
    saving,
    saveError,
    create,
  };
}
