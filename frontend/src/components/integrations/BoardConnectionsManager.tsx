'use client';

import { Select } from '@/components/Select';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';

import { useCallback, useEffect, useState } from 'react';
import {
  boardConnectionsApi,
  integrationsApi,
  type BoardConnection,
  type BoardProviderMeta,
  type IntegrationCredential,
} from '@/lib/builderforceApi';
import { useBoardProviders } from '@/lib/connectableCatalog';
import { useFormat } from "@/i18n/useFormat";
import { faultMessage } from '@/lib/apiClient';
import { useBoardConnectionStatusLabel } from './useBoardConnectionStatusLabel';
import { btnPrimary, btnSubtle, formPanel, inputStyle, panelCard } from './integrationStyles';
/**
 * Manage external board connections (project-management, ITSM, and incident
 * systems) for a project. Creating a connection immediately kicks off an
 * initial sync — that first full pull IS the data migration into Builderforce.
 * Shared between the project Integrations tab and the Task-Mgmt board-config
 * COG panel ("assign external boards to this board").
 *
 * The connectable providers, whether each needs an external board id, and its
 * hint come from the server's board catalog (`GET /api/board-connections/providers`,
 * the same list the create endpoint validates against) — this surface never
 * re-declares a list. The hint is translated by provider id
 * (`boardConnections.externalBoardIdHint.<id>`), falling back to the server's
 * English for a provider the catalogs have not caught up with.
 *
 * Recurring polling is driven by the Worker cron sweep (runBoardSyncSweep, every
 * 5 min) which polls each due connection and drains its reverse-sync outbox; the
 * "Sync now" button + the on-create sync are the manual triggers on top of that.
 */

const DEFAULT_POLL_SEC = 300;

/** Default picker selection — Jira if available, else the first board provider. */
export function defaultBoardProvider(boards: readonly BoardProviderMeta[]): string {
  return boards.some((b) => b.id === 'jira') ? 'jira' : (boards[0]?.id ?? '');
}

export function BoardConnectionsManager({ projectId, heading }: { projectId: number; heading?: string | null }) {
  const fmt = useFormat();
  const confirm = useConfirm();
  const tc = useTranslations('common');
  const t = useTranslations('boardConnections');
  const statusLabel = useBoardConnectionStatusLabel();
  const boards = useBoardProviders();
  // undefined default → localized fallback heading; null → headerless; string → as given.
  const resolvedHeading = heading === undefined ? t('heading') : heading;
  const [connections, setConnections] = useState<BoardConnection[]>([]);
  const [creds, setCreds] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<Record<string, { text: string; error: boolean }>>({});

  // '' = the default provider, resolved once the board catalog has loaded.
  const [provider, setProvider] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [externalBoardId, setExternalBoardId] = useState('');
  const [pollIntervalSec, setPollIntervalSec] = useState(DEFAULT_POLL_SEC);

  const selected = provider || defaultBoardProvider(boards);
  const providerMeta = boards.find((b) => b.id === selected);
  const boardLabel = (id: string) => boards.find((b) => b.id === id)?.label ?? id;
  const hint = (meta: BoardProviderMeta | undefined) => {
    if (!meta) return t('externalBoardIdPlaceholder');
    return t.has(`externalBoardIdHint.${meta.id}`) ? t(`externalBoardIdHint.${meta.id}`) : meta.externalBoardIdHint;
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      boardConnectionsApi.list(projectId),
      Promise.all([integrationsApi.list({ projectId }), integrationsApi.list({ scope: 'global' })]).then(([a, b]) => [...a, ...b]),
    ])
      .then(([conns, c]) => { setConnections(conns); setCreds(c); })
      .catch((e) => setError(faultMessage(e, t('loadError'))))
      .finally(() => setLoading(false));
  }, [projectId, t]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setProvider(''); setCredentialId(''); setExternalBoardId(''); setPollIntervalSec(DEFAULT_POLL_SEC); };

  const add = async () => {
    setError(null);
    if (providerMeta?.externalBoardId === 'required' && !externalBoardId.trim()) {
      setError(t('externalIdRequired', { provider: providerMeta.label, hint: hint(providerMeta) }));
      return;
    }
    setSaving(true);
    try {
      const conn = await boardConnectionsApi.create({
        projectId,
        provider: selected,
        credentialId: credentialId || null,
        externalBoardId: externalBoardId.trim() || null,
        pollIntervalSec,
      });
      // Kick off the first sync immediately so the board populates without waiting.
      boardConnectionsApi.sync(conn.id)
        .then(() => setSyncMsg((m) => ({ ...m, [conn.id]: { text: t('initialSyncStarted'), error: false } })))
        .catch((e) => setSyncMsg((m) => ({ ...m, [conn.id]: { text: e instanceof Error ? e.message : t('initialSyncFailed'), error: true } })))
        .finally(load);
      resetForm(); setAdding(false); load();
    } catch (e) {
      setError(faultMessage(e, t('createError')));
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async (id: string) => {
    setSyncing(id); setSyncMsg((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    try {
      await boardConnectionsApi.sync(id);
      setSyncMsg((m) => ({ ...m, [id]: { text: t('synced'), error: false } }));
    } catch (e) {
      setSyncMsg((m) => ({ ...m, [id]: { text: e instanceof Error ? e.message : t('syncFailed'), error: true } }));
    } finally {
      setSyncing(null); load();
    }
  };

  const remove = async (id: string) => { if (await confirm(tc('deleteBoardConnectionConfirm'))) { await boardConnectionsApi.remove(id); load(); } };

  const credName = (id: string | null) => creds.find((c) => c.id === id)?.name;
  // Keys that can back the selected board connection (provider must match).
  const pmCreds = creds.filter((c) => c.provider === selected);

  return (
    <div style={panelCard}>
      {resolvedHeading && <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{resolvedHeading}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {t('description')}
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>{tc('loading')}</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {connections.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('empty')}</div>}
          {connections.map((conn) => (
            <div key={conn.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', minWidth: 56 }}>{boardLabel(conn.provider)}</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 140 }}>
                  {conn.externalBoardId || t('boardFallback')} · {credName(conn.credentialId) ?? t('noKey')}
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                    {statusLabel(conn.status)}{conn.lastPolledAt ? ` · ${t('lastPolled', { time: fmt.dateTime(conn.lastPolledAt) })}` : ''}
                  </span>
                  {syncMsg[conn.id] && !syncMsg[conn.id].error && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>· {syncMsg[conn.id].text}</span>
                  )}
                </span>
                <button type="button" style={btnSubtle} disabled={syncing === conn.id} onClick={() => syncNow(conn.id)}>
                  {syncing === conn.id ? t('syncing') : t('syncNow')}
                </button>
                <button type="button" style={{ ...btnSubtle, color: 'var(--danger)' }} onClick={() => remove(conn.id)}>{tc('delete')}</button>
              </div>
              {syncMsg[conn.id]?.error && (
                <div
                  role="alert"
                  style={{
                    fontSize: 12, color: 'var(--error-text)',
                    background: 'var(--error-bg, rgba(220,38,38,0.08))',
                    border: '1px solid var(--error-border, rgba(220,38,38,0.3))',
                    borderRadius: 'var(--radius-sm)', padding: '6px 10px',
                  }}
                >
                  {t('syncFailedPrefix', { message: syncMsg[conn.id].text })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 10 }}>{error}</div>}

      {adding ? (
        <div style={formPanel}>
          <Select aria-label={t('providerSelect')} value={selected} onChange={(e) => { setProvider(e.target.value); setCredentialId(''); }} style={inputStyle}>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </Select>
          <Select aria-label={t('selectAccessKey')} value={credentialId} onChange={(e) => setCredentialId(e.target.value)} style={inputStyle}>
            <option value="">{t('selectAccessKey')}</option>
            {pmCreds.map((c) => <option key={c.id} value={c.id}>{c.name} ({boardLabel(c.provider)}{c.projectId == null ? t('workspaceSuffix') : ''})</option>)}
          </Select>
          <input
            style={inputStyle}
            aria-label={t('externalBoardIdPlaceholder')}
            placeholder={hint(providerMeta)}
            value={externalBoardId}
            onChange={(e) => setExternalBoardId(e.target.value)}
          />
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('pollIntervalLabel')}
            <input style={{ ...inputStyle, marginTop: 4 }} type="number" min={60} value={pollIntervalSec} onChange={(e) => setPollIntervalSec(Number(e.target.value))} />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary} disabled={saving || !selected} onClick={add}>{saving ? t('connecting') : t('connectAndSync')}</button>
            <button type="button" style={btnSubtle} onClick={() => { setAdding(false); resetForm(); setError(null); }}>{tc('cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={() => setAdding(true)}>{t('connectExternalBoard')}</button>
      )}
    </div>
  );
}
