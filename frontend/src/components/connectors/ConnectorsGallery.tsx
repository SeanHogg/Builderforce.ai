'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ClickableCard } from '@/components/ClickableCard';
import { ConnectToggleButton } from '@/components/integrations/ConnectToggleButton';
import { ConnectorBuilder } from '@/components/connectors/ConnectorBuilder';
import {
  authFieldsFor,
  connectorsApi,
  type ConnectorAction,
  type ConnectorCallLog,
  type ConnectorConnection,
  type ConnectorDetail,
  type ConnectorSummary,
} from '@/lib/connectorsApi';
import { getStoredTenant } from '@/lib/auth';

/**
 * Connector catalog — the breadth surface.
 *
 * Cards come from ONE server catalog (built-in manifests + this tenant's custom
 * connectors); nothing about which systems exist is declared here, so adding a
 * connector is a backend-only change and this component never drifts from it.
 *
 * "Connected" means at least one enabled connection — the same fact the server
 * uses to decide whether to advertise the connector's actions as agent tools, so
 * a card that says Connected is a promise the agents can act on it.
 */

const CATEGORY_ORDER = [
  'communication', 'crm', 'productivity', 'devtools',
  'finance', 'marketing', 'support', 'storage', 'data', 'other',
] as const;

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
  gap: 12,
};
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  cursor: 'pointer',
  textAlign: 'left',
  minWidth: 0,
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)', marginBottom: 5,
};

type PanelTab = 'connect' | 'actions' | 'activity';

export function ConnectorsGallery({ search = '', viewMode = 'card' }: { search?: string; viewMode?: 'card' | 'table' }) {
  const t = useTranslations('connectors');
  const confirm = useConfirm();
  const role = getStoredTenant()?.role;
  const canManage = role === 'owner' || role === 'manager';

  const [catalog, setCatalog] = useState<ConnectorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConnectorDetail | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('connect');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const load = useCallback(() => {
    connectorsApi.catalog()
      .then((r) => setCatalog(r.connectors))
      .catch(() => setCatalog([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // The panel needs the FULL manifest (actions, auth fields); the catalog row only
  // carries a summary, so the detail is fetched on open rather than up front for
  // every card.
  useEffect(() => {
    if (!activeKey) { setDetail(null); return; }
    let cancelled = false;
    connectorsApi.get(activeKey)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [activeKey]);

  const grouped = useMemo(() => {
    const query = search.trim().toLowerCase();
    const map = new Map<string, ConnectorSummary[]>();
    for (const c of catalog) {
      if (query && !`${c.name} ${c.key} ${c.description} ${c.category}`.toLowerCase().includes(query)) continue;
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [catalog, search]);

  const active = catalog.find((c) => c.key === activeKey) ?? null;

  const disconnect = async (c: ConnectorSummary) => {
    const ok = await confirm({
      message: t('gallery.confirmDisconnect', { name: c.name, count: c.connectionCount }),
      destructive: true,
    });
    if (!ok) return;
    const connections = await connectorsApi.listConnections(c.key).catch(() => [] as ConnectorConnection[]);
    await Promise.all(connections.map((x) => connectorsApi.removeConnection(x.id)));
    load();
  };

  const openBuilder = (key: string | null) => { setEditingKey(key); setBuilderOpen(true); };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('gallery.loading')}</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, flex: '1 1 240px' }}>
          {t('gallery.blurb', { count: catalog.length })}
        </p>
        {canManage && (
          <button type="button" style={btnPrimary} onClick={() => openBuilder(null)}>
            {t('gallery.buildConnector')}
          </button>
        )}
      </div>

      {catalog.length > 0 && grouped.size === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('gallery.noMatches')}</div>
      )}

      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            {t(`category.${cat}`)}
          </div>
          <div style={viewMode === 'card' ? cardGrid : { display: 'flex', flexDirection: 'column', gap: 8 }}>
            {grouped.get(cat)!.map((c) => (
              <ClickableCard
                key={c.key}
                ariaLabel={c.name}
                style={{ ...cardStyle, ...(viewMode === 'table' ? { flexDirection: 'row', alignItems: 'center' } : {}) }}
                onClick={() => { setActiveKey(c.key); setPanelTab('connect'); }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                  <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{c.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </span>
                  <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: c.connectionCount > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                    {c.connectionCount > 0 ? `● ${t('gallery.connected')}` : `○ ${t('gallery.notConnected')}`}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {c.description}
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('gallery.actionCount', { count: c.actionCount })}</span>
                  {c.origin === 'tenant' && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--coral-bright)', border: '1px solid var(--coral-bright)', borderRadius: 'var(--radius-sm)', padding: '1px 6px' }}>
                      {t('gallery.custom')}
                    </span>
                  )}
                  {c.status === 'draft' && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1px 6px' }}>
                      {t('gallery.draft')}
                    </span>
                  )}
                </div>
                {canManage && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ConnectToggleButton
                      connected={c.connectionCount > 0}
                      name={c.name}
                      onConnect={() => { setActiveKey(c.key); setPanelTab('connect'); }}
                      onDisconnect={() => disconnect(c)}
                    />
                  </div>
                )}
              </ClickableCard>
            ))}
          </div>
        </div>
      ))}

      {active && (
        <SlideOutPanel
          open={!!activeKey}
          onClose={() => setActiveKey(null)}
          title={`${active.icon} ${active.name}`}
          tabs={[
            { id: 'connect', label: t('panel.connections') },
            { id: 'actions', label: t('panel.actions') },
            { id: 'activity', label: t('panel.activity') },
          ]}
          activeTabId={panelTab}
          onTabChange={(id) => setPanelTab(id as PanelTab)}
          headerActions={
            detail?.editable && canManage ? (
              <button type="button" style={btnSubtle} onClick={() => openBuilder(active.key)}>
                {t('panel.edit')}
              </button>
            ) : null
          }
        >
          <div style={{ padding: 20 }}>
            {!detail && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('gallery.loading')}</div>}
            {detail && panelTab === 'connect' && (
              <ConnectionsTab detail={detail} canManage={canManage} onChanged={load} />
            )}
            {detail && panelTab === 'actions' && <ActionsTab detail={detail} />}
            {detail && panelTab === 'activity' && <ActivityTab connectorKey={detail.manifest.key} />}
          </div>
        </SlideOutPanel>
      )}

      <ConnectorBuilder
        open={builderOpen}
        editKey={editingKey}
        onClose={() => setBuilderOpen(false)}
        onSaved={() => { setBuilderOpen(false); load(); }}
      />
    </div>
  );
}

// ── Connections tab ──────────────────────────────────────────────────────────

function ConnectionsTab({ detail, canManage, onChanged }: {
  detail: ConnectorDetail;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('connectors');
  // Shared strings come from the `common` namespace rather than being duplicated
  // per feature — see the i18n convention in /settings.
  const tc = useTranslations('common');
  const confirm = useConfirm();
  const fields = authFieldsFor(detail.manifest);

  const [rows, setRows] = useState<ConnectorConnection[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [baseUrlOverride, setBaseUrlOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    connectorsApi.listConnections(detail.manifest.key).then(setRows).catch(() => setRows([]));
  }, [detail.manifest.key]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setBusy(true); setMessage(null);
    try {
      await connectorsApi.createConnection({
        connectorKey: detail.manifest.key,
        name: name.trim() || detail.manifest.name,
        credentials: values,
        baseUrlOverride: baseUrlOverride.trim() || null,
      });
      setAdding(false); setName(''); setValues({}); setBaseUrlOverride('');
      load(); onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : t('connect.failed') });
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: string) => {
    setBusy(true); setMessage(null);
    try {
      const r = await connectorsApi.testConnection(id);
      setMessage({ ok: r.ok, text: r.message });
      load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : t('connect.testFailed') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: ConnectorConnection) => {
    if (!(await confirm({ message: t('connect.confirmRemove', { name: row.name }), destructive: true }))) return;
    await connectorsApi.removeConnection(row.id);
    load(); onChanged();
  };

  const toggle = async (row: ConnectorConnection) => {
    await connectorsApi.updateConnection(row.id, { enabled: !row.enabled });
    load(); onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
        {detail.manifest.description}
        {detail.manifest.docsUrl && (
          <>
            {' '}
            <a href={detail.manifest.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--coral-bright)' }}>
              {t('panel.apiDocs')}
            </a>
          </>
        )}
      </p>

      {message && (
        <div style={{ fontSize: 12, color: message.ok ? 'var(--success)' : 'var(--danger)' }}>
          {message.text}
        </div>
      )}

      {rows == null && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('gallery.loading')}</div>}
      {rows?.length === 0 && !adding && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('connect.empty')}</div>
      )}

      {rows?.map((row) => (
        <div key={row.id} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{row.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {Object.entries(row.publicFields).map(([k, v]) => `${k}: ${v}`).join(' · ') || t('connect.credentialsStored', { count: row.secretFieldsSet.length })}
            </div>
          </div>
          <span style={{ fontSize: 11, color: row.lastTestOk === false ? 'var(--danger)' : row.lastTestOk ? 'var(--success)' : 'var(--text-muted)' }}>
            {row.lastTestOk == null ? t('connect.untested') : row.lastTestOk ? t('connect.healthy') : t('connect.failing')}
          </span>
          {canManage && (
            <>
              <button type="button" style={btnSubtle} disabled={busy} onClick={() => test(row.id)}>{t('connect.test')}</button>
              <button type="button" style={btnSubtle} onClick={() => toggle(row)}>
                {row.enabled ? t('connect.disable') : t('connect.enable')}
              </button>
              <button type="button" style={{ ...btnSubtle, color: 'var(--danger)' }} onClick={() => remove(row)}>
                {t('connect.remove')}
              </button>
            </>
          )}
        </div>
      ))}

      {canManage && !adding && (
        <div>
          <button type="button" style={btnPrimary} onClick={() => setAdding(true)}>{t('connect.add')}</button>
        </div>
      )}

      {canManage && adding && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="conn-name">{t('connect.nameLabel')}</label>
            <input id="conn-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder={detail.manifest.name} />
          </div>
          {fields.map((f) => (
            <div key={f.key}>
              <label style={labelStyle} htmlFor={`conn-${f.key}`}>
                {f.label}{f.required ? ' *' : ''}
              </label>
              <input
                id={`conn-${f.key}`}
                style={inputStyle}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                value={values[f.key] ?? ''}
                placeholder={f.placeholder ?? ''}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
              />
              {f.help && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>{f.help}</p>}
            </div>
          ))}
          <div>
            <label style={labelStyle} htmlFor="conn-base">{t('connect.baseUrlOverride')}</label>
            <input id="conn-base" style={inputStyle} value={baseUrlOverride} onChange={(e) => setBaseUrlOverride(e.target.value)} placeholder={detail.manifest.baseUrl} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('connect.baseUrlHelp')}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary} disabled={busy} onClick={submit}>
              {busy ? t('connect.saving') : t('connect.save')}
            </button>
            <button type="button" style={btnSubtle} onClick={() => { setAdding(false); setMessage(null); }}>
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Actions tab: what the agents can do once this is connected ───────────────

function ActionsTab({ detail }: { detail: ConnectorDetail }) {
  const t = useTranslations('connectors');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>{t('actions.blurb')}</p>
      {detail.manifest.actions.map((a: ConnectorAction) => (
        <div key={a.key} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{a.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 'var(--radius-sm)', padding: '1px 5px', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
              {a.method}
            </span>
            {a.mutates && (
              <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 'var(--radius-sm)', padding: '1px 5px', border: '1px solid var(--coral-bright)', color: 'var(--coral-bright)' }}>
                {t('actions.writes')}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>{a.description}</p>
          {Object.keys(a.params).length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', wordBreak: 'break-word' }}>
              {t('actions.inputs')}: {Object.keys(a.params).join(', ')}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Activity tab: the audit trail ────────────────────────────────────────────

function ActivityTab({ connectorKey }: { connectorKey: string }) {
  const t = useTranslations('connectors');
  const [logs, setLogs] = useState<ConnectorCallLog[] | null>(null);

  useEffect(() => {
    connectorsApi.logs(undefined, 50)
      .then((all) => setLogs(all.filter((l) => l.connectorKey === connectorKey)))
      .catch(() => setLogs([]));
  }, [connectorKey]);

  if (logs == null) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('gallery.loading')}</div>;
  if (logs.length === 0) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('activity.empty')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {logs.map((l) => (
        <div key={l.id} style={{ display: 'flex', gap: 10, fontSize: 11.5, color: 'var(--text-secondary)', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
          <span style={{ color: l.ok ? 'var(--success)' : 'var(--danger)' }}>● {l.statusCode ?? '—'}</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{l.actionKey}</span>
          <span>{t(`activity.actor.${l.actorKind === 'user' || l.actorKind === 'test' ? l.actorKind : 'agent'}`)}</span>
          <span>{new Date(l.createdAt).toLocaleString()}</span>
          {l.durationMs != null && <span>{l.durationMs}ms</span>}
          {l.error && <span style={{ color: 'var(--danger)', flexBasis: '100%', wordBreak: 'break-word' }}>{l.error}</span>}
        </div>
      ))}
    </div>
  );
}
