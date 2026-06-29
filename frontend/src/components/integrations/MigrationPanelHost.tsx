'use client';

import { useCallback, useEffect, useState } from 'react';
import { MigrationWizard } from '@/components/integrations/MigrationWizard';
import { boardConnectionsApi, integrationsApi, type BoardProviderMeta, type IntegrationCredential } from '@/lib/builderforceApi';

/**
 * App-wide host for the Brain-driven migration panel. The Brain (docked on the
 * RIGHT) calls the `open_migration_panel` client action, which dispatches a
 * `builderforce:open-migration-panel` window event; this host opens the
 * MigrationWizard on the LEFT so the two sit side-by-side. Mounted once near the
 * BrainPanel so any surface can be driven into reconciliation by the Brain.
 */
export function MigrationPanelHost() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<IntegrationCredential[]>([]);
  const [providersMeta, setProvidersMeta] = useState<BoardProviderMeta[]>([]);

  const onOpen = useCallback((e: Event) => {
    const detail = (e as CustomEvent<{ runId: string | null; provider: string | null }>).detail ?? { runId: null, provider: null };
    setRunId(detail.runId);
    setProvider(detail.provider);
    setOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener('builderforce:open-migration-panel', onOpen);
    return () => window.removeEventListener('builderforce:open-migration-panel', onOpen);
  }, [onOpen]);

  // Load the provider catalog + this provider's credentials when the panel opens.
  useEffect(() => {
    if (!open) return;
    boardConnectionsApi.providers().then(setProvidersMeta).catch(() => undefined);
    if (provider) {
      integrationsApi.list({ scope: 'global' })
        .then((all) => setCredentials(all.filter((c) => c.provider === provider)))
        .catch(() => setCredentials([]));
    }
  }, [open, provider]);

  if (!open || !provider) return null;
  const label = providersMeta.find((p) => p.id === provider)?.label ?? provider;

  return (
    <MigrationWizard
      open={open}
      onClose={() => setOpen(false)}
      side="left"
      provider={provider}
      providerLabel={label}
      credentials={credentials}
      initialRunId={runId}
    />
  );
}
