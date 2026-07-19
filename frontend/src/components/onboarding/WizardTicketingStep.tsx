'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { boardConnectionsApi, type BoardProviderMeta, type BoardConnection } from '@/lib/builderforceApi';

/**
 * Onboarding step: connect a ticketing / work-tracking system (Jira, Monday,
 * Linear, …) to the new project. Reuses the board-connection catalog + create
 * API (the same registry the Integrations gallery uses) so there is one source
 * of connectable providers. Skippable — credential/board completion happens in
 * Integrations after setup; here we register the intent so the project is bound
 * to a provider.
 */
export function WizardTicketingStep({ projectId }: { projectId: number }) {
  const t = useTranslations('onboarding.ticketing');
  const [providers, setProviders] = useState<BoardProviderMeta[]>([]);
  const [connections, setConnections] = useState<BoardConnection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([boardConnectionsApi.providers(), boardConnectionsApi.list(projectId)])
      .then(([p, c]) => { if (live) { setProviders(p.filter((x) => x.category === 'pm' || x.category === 'itsm')); setConnections(c); } })
      .catch(() => { if (live) setError(t('errLoad')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId, t]);

  const connectedIds = new Set(connections.map((c) => c.provider));

  const connect = async (provider: string) => {
    setBusy(provider);
    setError(null);
    try {
      const conn = await boardConnectionsApi.create({ projectId, provider });
      setConnections((prev) => [...prev, conn]);
    } catch {
      setError(t('errConnect'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>{t('intro')}</p>
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{t('loading')}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {providers.map((p) => {
            const connected = connectedIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => !connected && connect(p.id)}
                disabled={connected || busy === p.id}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start',
                  padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                  background: connected ? 'rgba(34,197,94,0.12)' : 'var(--bg-elevated)',
                  border: `1px solid ${connected ? 'rgba(34,197,94,0.4)' : 'var(--border-subtle)'}`,
                  color: 'var(--text-primary)', cursor: connected ? 'default' : 'pointer',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</span>
                <span style={{ fontSize: 11, color: connected ? '#22c55e' : 'var(--text-muted)' }}>
                  {connected ? t('connected') : busy === p.id ? t('connecting') : t('connect')}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error && <p style={{ color: 'var(--error-text, #e74c3c)', fontSize: 13, marginTop: 10 }}>{error}</p>}
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>{t('finishLater')}</p>
    </div>
  );
}
