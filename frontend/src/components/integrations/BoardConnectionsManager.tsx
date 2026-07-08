'use client';

import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';

import { useCallback, useEffect, useState } from 'react';
import {
  boardConnectionsApi,
  integrationsApi,
  type BoardConnection,
  type IntegrationCredential,
  type IntegrationProvider,
} from '@/lib/builderforceApi';
import { PROVIDER_META } from './IntegrationCredentialsManager';

/**
 * Manage external board connections (project-management, ITSM, and incident
 * systems) for a project. Creating a connection immediately kicks off an
 * initial sync — that first full pull IS the data migration into Builderforce.
 * Shared between the project Integrations tab and the Task-Mgmt board-config
 * COG panel ("assign external boards to this board").
 *
 * The connectable providers + their external-board-id hints are derived from
 * PROVIDER_META (the single source) — every provider whose meta carries a
 * `board` capability shows up here, so this surface never re-declares a list.
 *
 * Recurring polling is driven by the Worker cron sweep (runBoardSyncSweep, every
 * 5 min) which polls each due connection and drains its reverse-sync outbox; the
 * "Sync now" button + the on-create sync are the manual triggers on top of that.
 */

/** [id, meta] for every provider that can be connected as a synced board. */
const BOARD_PROVIDERS = (Object.entries(PROVIDER_META) as [IntegrationProvider, (typeof PROVIDER_META)[IntegrationProvider]][])
  .filter(([, m]) => m.board);

/** Default picker selection — Jira if available, else the first board provider. */
const DEFAULT_BOARD_PROVIDER: string = BOARD_PROVIDERS.some(([id]) => id === 'jira')
  ? 'jira'
  : (BOARD_PROVIDERS[0]?.[0] ?? 'jira');

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};
const inputStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 8,
  background: 'var(--bg-deep)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};

export function BoardConnectionsManager({ projectId, heading = 'External boards' }: { projectId: number; heading?: string | null }) {
  const confirm = useConfirm();
  const [connections, setConnections] = useState<BoardConnection[]>([]);
  const [creds, setCreds] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<Record<string, { text: string; error: boolean }>>({});

  const [provider, setProvider] = useState<string>(DEFAULT_BOARD_PROVIDER);
  const [credentialId, setCredentialId] = useState('');
  const [externalBoardId, setExternalBoardId] = useState('');
  const [pollIntervalSec, setPollIntervalSec] = useState(300);

  const providerMeta = PROVIDER_META[provider as IntegrationProvider];

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      boardConnectionsApi.list(projectId),
      Promise.all([integrationsApi.list({ projectId }), integrationsApi.list({ scope: 'global' })]).then(([a, b]) => [...a, ...b]),
    ])
      .then(([conns, c]) => { setConnections(conns); setCreds(c); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load board connections'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setProvider(DEFAULT_BOARD_PROVIDER); setCredentialId(''); setExternalBoardId(''); setPollIntervalSec(300); };

  const add = async () => {
    setError(null);
    if (providerMeta?.board?.externalId === 'required' && !externalBoardId.trim()) {
      setError(`${providerMeta.label} boards need a value: ${providerMeta.board.hint}`);
      return;
    }
    setSaving(true);
    try {
      const conn = await boardConnectionsApi.create({
        projectId,
        provider,
        credentialId: credentialId || null,
        externalBoardId: externalBoardId.trim() || null,
        pollIntervalSec,
      });
      // Kick off the first sync immediately so the board populates without waiting.
      boardConnectionsApi.sync(conn.id)
        .then(() => setSyncMsg((m) => ({ ...m, [conn.id]: { text: 'Initial sync started', error: false } })))
        .catch((e) => setSyncMsg((m) => ({ ...m, [conn.id]: { text: e instanceof Error ? e.message : 'Initial sync failed', error: true } })))
        .finally(load);
      resetForm(); setAdding(false); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create connection');
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async (id: string) => {
    setSyncing(id); setSyncMsg((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    try {
      await boardConnectionsApi.sync(id);
      setSyncMsg((m) => ({ ...m, [id]: { text: 'Synced', error: false } }));
    } catch (e) {
      setSyncMsg((m) => ({ ...m, [id]: { text: e instanceof Error ? e.message : 'Sync failed', error: true } }));
    } finally {
      setSyncing(null); load();
    }
  };

  const remove = async (id: string) => { if (await confirm('Delete this board connection?')) { await boardConnectionsApi.remove(id); load(); } };

  const credName = (id: string | null) => creds.find((c) => c.id === id)?.name;
  // Keys that can back the selected board connection (provider must match).
  const pmCreds = creds.filter((c) => c.provider === provider);

  return (
    <div style={cardStyle}>
      {heading && <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{heading}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Connect an external work, ITSM, or incident board (Jira, Linear, ServiceNow, Sentry and more)
        to sync tickets into this project. The first sync imports existing items.
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>Loading…</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {connections.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No external boards connected.</div>}
          {connections.map((conn) => (
            <div key={conn.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', minWidth: 56 }}>{conn.provider}</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
                  {conn.externalBoardId || '(board)'} · {credName(conn.credentialId) ?? 'no key'}
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                    {conn.status}{conn.lastPolledAt ? ` · last ${new Date(conn.lastPolledAt).toLocaleString()}` : ''}
                  </span>
                  {syncMsg[conn.id] && !syncMsg[conn.id].error && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>· {syncMsg[conn.id].text}</span>
                  )}
                </span>
                <button type="button" style={btnSubtle} disabled={syncing === conn.id} onClick={() => syncNow(conn.id)}>
                  {syncing === conn.id ? 'Syncing…' : 'Sync now'}
                </button>
                <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(conn.id)}>Delete</button>
              </div>
              {syncMsg[conn.id]?.error && (
                <div
                  role="alert"
                  style={{
                    fontSize: 12, color: 'var(--error-text, #dc2626)',
                    background: 'var(--error-bg, rgba(220,38,38,0.08))',
                    border: '1px solid var(--error-border, rgba(220,38,38,0.3))',
                    borderRadius: 6, padding: '6px 10px',
                  }}
                >
                  Sync failed: {syncMsg[conn.id].text}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 10 }}>{error}</div>}

      {adding ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--bg-deep)', borderRadius: 10 }}>
          <Select value={provider} onChange={(e) => { setProvider(e.target.value); setCredentialId(''); }} style={inputStyle}>
            {BOARD_PROVIDERS.map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
          </Select>
          <Select value={credentialId} onChange={(e) => setCredentialId(e.target.value)} style={inputStyle}>
            <option value="">— Select access key —</option>
            {pmCreds.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.provider}{c.projectId == null ? ', workspace' : ''})</option>)}
          </Select>
          <input
            style={inputStyle}
            placeholder={providerMeta?.board?.hint ?? 'External board id'}
            value={externalBoardId}
            onChange={(e) => setExternalBoardId(e.target.value)}
          />
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Poll interval (seconds)
            <input style={{ ...inputStyle, marginTop: 4 }} type="number" min={60} value={pollIntervalSec} onChange={(e) => setPollIntervalSec(Number(e.target.value))} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btnPrimary} disabled={saving} onClick={add}>{saving ? 'Connecting…' : 'Connect & sync'}</button>
            <button type="button" style={btnSubtle} onClick={() => { setAdding(false); resetForm(); setError(null); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={() => setAdding(true)}>Connect external board</button>
      )}
    </div>
  );
}
