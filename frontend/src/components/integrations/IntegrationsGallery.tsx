'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { IntegrationCredentialsManager, PROVIDER_META } from '@/components/integrations/IntegrationCredentialsManager';
import { MigrationWizard } from '@/components/integrations/MigrationWizard';
import {
  boardConnectionsApi,
  integrationsApi,
  type BoardProviderMeta,
  type BoardConnection,
  type IntegrationCredential,
  type IntegrationProvider,
} from '@/lib/builderforceApi';
import { getStoredTenant } from '@/lib/auth';

/**
 * Integrations gallery — the workspace-level home for every external system.
 * Cards derive from the board-provider catalog (single source of truth) plus the
 * credential-only providers (Confluence). Each card shows connected state and
 * opens a config side panel (Credentials · Connections · Activity) with a
 * "Start migration" launcher for providers that support discovery.
 *
 * The migration wizard + ongoing sync are the two halves of the platform-move
 * story; both hang off the same per-provider panel here.
 */

const CATEGORY_ORDER: BoardProviderMeta['category'][] = ['pm', 'scm', 'itsm', 'incident'];

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 12,
};
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  cursor: 'pointer',
  textAlign: 'left',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)',
  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};

type PanelTab = 'credentials' | 'connections' | 'activity';

export function IntegrationsGallery() {
  const t = useTranslations('integrations');
  const role = getStoredTenant()?.role;
  const canManage = role === 'owner' || role === 'manager';

  const [providersMeta, setProvidersMeta] = useState<BoardProviderMeta[]>([]);
  const [credentials, setCredentials] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('credentials');
  const [wizardOpen, setWizardOpen] = useState(false);

  const loadCreds = useCallback(() => {
    integrationsApi.list({ scope: 'global' }).then(setCredentials).catch(() => undefined);
  }, []);

  useEffect(() => {
    Promise.all([boardConnectionsApi.providers().catch(() => []), integrationsApi.list({ scope: 'global' }).catch(() => [])])
      .then(([p, c]) => { setProvidersMeta(p); setCredentials(c); })
      .finally(() => setLoading(false));
  }, []);

  const credsByProvider = useMemo(() => {
    const map = new Map<string, IntegrationCredential[]>();
    for (const c of credentials) {
      const list = map.get(c.provider) ?? [];
      list.push(c);
      map.set(c.provider, list);
    }
    return map;
  }, [credentials]);

  // Gallery cards: catalog providers + credential-only providers (e.g. confluence)
  // that aren't connectable boards but still need a credential home.
  const cards = useMemo(() => {
    const ids = new Set(providersMeta.map((p) => p.id));
    const extra: BoardProviderMeta[] = (Object.keys(PROVIDER_META) as IntegrationProvider[])
      .filter((id) => !ids.has(id))
      .map((id) => ({ id, label: PROVIDER_META[id].label, category: 'scm', externalBoardId: 'optional', externalBoardIdHint: '', supportsWebhook: false, supportsDiscovery: false }));
    return [...providersMeta, ...extra];
  }, [providersMeta]);

  const grouped = useMemo(() => {
    const g = new Map<BoardProviderMeta['category'], BoardProviderMeta[]>();
    for (const c of cards) {
      const list = g.get(c.category) ?? [];
      list.push(c);
      g.set(c.category, list);
    }
    return g;
  }, [cards]);

  const activeMeta = cards.find((c) => c.id === activeProvider) ?? null;
  const activeCreds = activeProvider ? (credsByProvider.get(activeProvider) ?? []) : [];

  const openProvider = (id: string) => { setActiveProvider(id); setPanelTab('credentials'); };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('gallery.loading')}</div>;

  return (
    <div>
      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            {t(`gallery.category.${cat}`)}
          </div>
          <div style={cardGrid}>
            {grouped.get(cat)!.map((p) => {
              const count = credsByProvider.get(p.id)?.length ?? 0;
              return (
                <button key={p.id} type="button" style={cardStyle} onClick={() => openProvider(p.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{p.label}</span>
                    <span style={{ fontSize: 11, color: count > 0 ? 'var(--success, #16a34a)' : 'var(--text-muted)' }}>
                      {count > 0 ? `● ${t('gallery.connected')}` : `○ ${t('gallery.notConnected')}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {p.supportsDiscovery && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--coral-bright)', border: '1px solid var(--coral-bright)', borderRadius: 6, padding: '1px 6px' }}>
                        {t('gallery.migratable')}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{count > 0 ? t('gallery.keyCount', { count }) : t('gallery.tapToConnect')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* ── Per-provider config panel ─────────────────────────── */}
      {activeMeta && (
        <SlideOutPanel
          open={!!activeProvider}
          onClose={() => setActiveProvider(null)}
          title={activeMeta.label}
          tabs={[
            { id: 'credentials', label: t('panel.credentials') },
            { id: 'connections', label: t('panel.connections') },
            { id: 'activity', label: t('panel.activity') },
          ]}
          activeTabId={panelTab}
          onTabChange={(id) => setPanelTab(id as PanelTab)}
          headerActions={
            activeMeta.supportsDiscovery && canManage ? (
              <button type="button" style={btnPrimary} onClick={() => setWizardOpen(true)} disabled={activeCreds.length === 0}>
                {t('panel.startMigration')}
              </button>
            ) : null
          }
        >
          <div style={{ padding: 20 }}>
            {panelTab === 'credentials' && (
              <IntegrationCredentialsManager providers={[activeMeta.id as IntegrationProvider]} heading={null} />
            )}
            {panelTab === 'connections' && <ConnectionsTab provider={activeMeta.id} onChanged={loadCreds} t={t} />}
            {panelTab === 'activity' && <ActivityTab credentials={activeCreds} t={t} />}
          </div>
        </SlideOutPanel>
      )}

      {activeMeta && (
        <MigrationWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          provider={activeMeta.id}
          providerLabel={activeMeta.label}
          credentials={activeCreds}
          onImported={loadCreds}
        />
      )}
    </div>
  );
}

// ── Connections tab: workspace-wide list of this provider's connections ───────
function ConnectionsTab({ provider, onChanged, t }: { provider: string; t: ReturnType<typeof useTranslations>; onChanged: () => void }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<BoardConnection[] | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    boardConnectionsApi.list().then((all) => setRows(all.filter((c) => c.provider === provider))).catch(() => setRows([]));
  }, [provider]);
  useEffect(() => { load(); }, [load]);

  const syncNow = async (id: string) => {
    setSyncing(id); setMsg(null);
    try { await boardConnectionsApi.sync(id); setMsg(t('connections.syncQueued')); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : t('connections.syncFailed')); }
    finally { setSyncing(null); }
  };
  const remove = async (id: string) => {
    if (!(await confirm(t('connections.confirmRemove')))) return;
    await boardConnectionsApi.remove(id); load(); onChanged();
  };

  if (rows == null) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('gallery.loading')}</div>;
  if (rows.length === 0) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('connections.empty')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {msg && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{msg}</div>}
      {rows.map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 120, fontSize: 13, color: 'var(--text-primary)' }}>
            {c.externalBoardId || t('connections.allBoards')}
          </span>
          <span style={{ fontSize: 11, color: c.status === 'active' ? 'var(--success, #16a34a)' : 'var(--text-muted)' }}>● {c.status}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {c.lastPolledAt ? t('connections.lastPolled', { time: new Date(c.lastPolledAt).toLocaleString() }) : t('connections.neverPolled')}
          </span>
          <button type="button" style={btnSubtle} disabled={syncing === c.id} onClick={() => syncNow(c.id)}>
            {syncing === c.id ? t('connections.syncing') : t('connections.syncNow')}
          </button>
          <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(c.id)}>{t('connections.remove')}</button>
        </div>
      ))}
    </div>
  );
}

// ── Activity tab: diagnostics (test) + execution history (sync logs) ──────────
interface SyncLog { id: number; status: string; itemsProcessed: number; itemsErrored: number; errorMessage: string | null; durationMs: number | null; startedAt: string }

function ActivityTab({ credentials, t }: { credentials: IntegrationCredential[]; t: ReturnType<typeof useTranslations> }) {
  const [logs, setLogs] = useState<Record<string, SyncLog[]>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => {
    credentials.forEach((c) => {
      integrationsApi.syncLogs(c.id, 10).then((l) => setLogs((p) => ({ ...p, [c.id]: l as unknown as SyncLog[] }))).catch(() => undefined);
    });
  }, [credentials]);

  const test = async (id: string) => {
    setTesting(id);
    try { const r = await integrationsApi.test(id); setResults((p) => ({ ...p, [id]: r })); }
    catch (e) { setResults((p) => ({ ...p, [id]: { ok: false, message: e instanceof Error ? e.message : 'failed' } })); }
    finally { setTesting(null); }
  };

  if (credentials.length === 0) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('activity.noCredentials')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {credentials.map((c) => {
        const r = results[c.id];
        const ok = r ? r.ok : c.lastTestOk;
        return (
          <div key={c.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{c.name}</span>
              {ok != null && <span style={{ fontSize: 11, color: ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>{ok ? t('activity.healthy') : t('activity.failing')}</span>}
              <button type="button" style={btnSubtle} disabled={testing === c.id} onClick={() => test(c.id)}>
                {testing === c.id ? t('activity.testing') : t('activity.runDiagnostic')}
              </button>
            </div>
            {r && !r.ok && <div style={{ fontSize: 11, color: 'var(--danger, #dc2626)', marginBottom: 6 }}>{r.message}</div>}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{t('activity.history')}</div>
            {(logs[c.id] ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('activity.noRuns')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(logs[c.id] ?? []).map((l) => (
                  <div key={l.id} style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                    <span style={{ color: l.status === 'success' ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>● {l.status}</span>
                    <span>{new Date(l.startedAt).toLocaleString()}</span>
                    <span>{t('activity.processed', { count: l.itemsProcessed })}</span>
                    {l.itemsErrored > 0 && <span style={{ color: 'var(--danger, #dc2626)' }}>{t('activity.errored', { count: l.itemsErrored })}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
