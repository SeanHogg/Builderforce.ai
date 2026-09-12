'use client';

import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { integrationsApi, type IntegrationCredential } from '@/lib/builderforceApi';
import { getStoredTenant } from '@/lib/auth';
import { faultMessage } from '@/lib/apiClient';
import { useConnectableCatalog, type ConnectableProvider } from '@/lib/connectableCatalog';
import { CredentialKeyForm, type CredentialKeyEdit } from './CredentialKeyForm';
import { credentialsPayload, type CredentialDraft } from './credentialDraft';
import { btnPrimary, btnSubtle, panelCard } from './integrationStyles';
/**
 * Shared credential manager used by BOTH the workspace Settings page (global
 * keys) and the project detail "Integrations" tab (project-scoped keys). The
 * list / add / test / delete logic lives here once; the only behavioural switch
 * is the optional `projectId`:
 *
 *   projectId undefined → workspace-global creds (scope=global)
 *   projectId set        → that project's creds, plus inherited workspace-global
 *                          creds shown read-only.
 *
 * WHICH providers can be connected, and what each asks for, comes from the
 * server's connect catalog (`useConnectableCatalog`) — this file names no
 * provider. The form itself is `CredentialKeyForm`.
 *
 * Self-gating on role (owner/manager) — writes are also role-gated server-side
 * (requireRole(MANAGER)), so callers need no `canManage` prop.
 */

export interface IntegrationCredentialsManagerProps {
  /** Omit for workspace-global keys; set to scope keys to a single project. */
  projectId?: number;
  /** Restrict to these provider ids (e.g. one gallery card). Omit for every catalog provider. */
  providers?: string[];
  /** Optional heading; pass null to render headerless (e.g. inside a tab). */
  heading?: string | null;
}

/** Keep a provider-specific drawer from leaking unrelated workspace keys. */
export function filterCredentialsByProvider(
  credentials: IntegrationCredential[],
  providerFilterKey: string,
): IntegrationCredential[] {
  const allowedProviders = new Set(providerFilterKey.split('|'));
  return credentials.filter((credential) => allowedProviders.has(credential.provider));
}

export function IntegrationCredentialsManager({ projectId, providers, heading }: IntegrationCredentialsManagerProps) {
  const confirm = useConfirm();
  const tc = useTranslations('common');
  const t = useTranslations('integrationCredentials');
  const role = getStoredTenant()?.role;
  const canManage = role === 'owner' || role === 'manager';
  const { catalog, byId, loading: catalogLoading, failed: catalogFailed } = useConnectableCatalog();

  // A stable primitive keeps the loader in sync even though callers commonly pass
  // a fresh one-item array. null = no restriction.
  const providerFilterKey = providers ? providers.join('|') : null;
  const offered = useMemo<ConnectableProvider[]>(() => {
    if (providerFilterKey == null) return catalog?.providers ?? [];
    return providerFilterKey.split('|').map((id) => byId.get(id)).filter((p): p is ConnectableProvider => p != null);
  }, [providerFilterKey, catalog, byId]);

  const [scoped, setScoped] = useState<IntegrationCredential[]>([]);
  const [inherited, setInherited] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // When set, the form is in EDIT mode for this credential (rotate key / rename /
  // change base URL) rather than creating a new one.
  const [editing, setEditing] = useState<CredentialKeyEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const load = useCallback(() => {
    if (!canManage) return;
    setLoading(true);
    const scopedP = projectId != null
      ? integrationsApi.list({ projectId })
      : integrationsApi.list({ scope: 'global' });
    const inheritedP = projectId != null
      ? integrationsApi.list({ scope: 'global' })
      : Promise.resolve<IntegrationCredential[]>([]);
    const keep = (rows: IntegrationCredential[]) =>
      providerFilterKey == null ? rows : filterCredentialsByProvider(rows, providerFilterKey);
    Promise.all([scopedP, inheritedP])
      .then(([s, i]) => {
        setScoped(keep(s));
        setInherited(keep(i));
      })
      .catch(() => setError(t('loadError')))
      .finally(() => setLoading(false));
  }, [canManage, projectId, providerFilterKey, t]);

  useEffect(() => { load(); }, [load]);

  if (!canManage) return null;

  // undefined default → localized fallback heading; null → headerless; string → as given.
  const resolvedHeading = heading === undefined ? t('heading') : heading;
  const editingDescriptor = editing ? byId.get(editing.provider) : undefined;

  const closeForm = () => {
    setAdding(false); setEditing(null); setError(null);
  };

  const openEdit = (c: IntegrationCredential) => {
    setEditing({ id: c.id, provider: c.provider, name: c.name, baseUrl: c.baseUrl });
    setError(null);
    setAdding(true);
  };

  const save = async (draft: CredentialDraft, rotating: boolean) => {
    const descriptor = byId.get(draft.provider);
    if (!descriptor) return;
    setSaving(true);
    setError(null);
    const name = draft.name.trim() || t('defaultKeyName', { provider: descriptor.label });
    const baseUrl = descriptor.baseUrl === 'none' ? null : draft.baseUrl.trim() || null;
    try {
      if (editing) {
        await integrationsApi.update(editing.id, {
          name,
          baseUrl,
          ...(rotating ? { credentials: credentialsPayload(descriptor, draft) } : {}),
        });
      } else {
        await integrationsApi.create({
          provider: descriptor.id,
          name,
          baseUrl,
          projectId: projectId ?? null,
          credentials: credentialsPayload(descriptor, draft),
        });
      }
      closeForm();
      load();
    } catch (e) {
      setError(faultMessage(e, t('saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    try {
      const res = await integrationsApi.test(id);
      setTestResult((prev) => ({ ...prev, [id]: res }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, message: e instanceof Error ? e.message : t('testFailed') } }));
    } finally {
      setTesting(null);
      load();
    }
  };

  const toggleEnabled = async (credential: IntegrationCredential) => {
    setToggling(credential.id);
    setError(null);
    try {
      await integrationsApi.update(credential.id, { isEnabled: !credential.isEnabled });
      load();
    } catch (e) {
      setError(faultMessage(e, t('toggleFailed')));
    } finally {
      setToggling(null);
    }
  };

  const remove = async (id: string) => {
    if (!(await confirm(tc('deleteIntegrationKeyConfirm')))) return;
    await integrationsApi.remove(id);
    load();
  };

  const renderRow = (c: IntegrationCredential, readOnly: boolean) => {
    const result = testResult[c.id];
    const ok = result ? result.ok : c.lastTestOk;
    return (
      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', minWidth: 78 }}>
          {byId.get(c.provider)?.label ?? c.provider}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 120 }}>
          {c.name}
          {readOnly && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{t('workspaceTag')}</span>}
        </span>
        {ok != null && (
          <span style={{ fontSize: 11, color: ok ? 'var(--success)' : 'var(--danger)' }}>
            {ok ? `● ${t('connected')}` : `● ${t('failed')}`}
          </span>
        )}
        {result && !result.ok && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{result.message}</span>}
        {!readOnly && (
          <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', cursor: toggling === c.id ? 'wait' : 'pointer' }}>
              <input
                type="checkbox"
                aria-label={t('toggleLabel', { name: c.name })}
                checked={c.isEnabled}
                disabled={toggling === c.id}
                onChange={() => void toggleEnabled(c)}
              />
              {c.isEnabled ? t('enabled') : t('disabled')}
            </label>
            <button type="button" style={btnSubtle} disabled={testing === c.id || !c.isEnabled} onClick={() => test(c.id)}>
              {testing === c.id ? t('testing') : t('test')}
            </button>
            {/* Editing needs the provider's form; a key for a provider the catalog
                no longer describes can still be tested and deleted. */}
            {byId.has(c.provider) && (
              <button type="button" style={btnSubtle} onClick={() => openEdit(c)}>
                {tc('edit')}
              </button>
            )}
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger)' }} onClick={() => remove(c.id)}>
              {tc('delete')}
            </button>
          </>
        )}
      </div>
    );
  };

  const formProviders = editingDescriptor ? [editingDescriptor] : offered;

  return (
    <div style={panelCard}>
      {resolvedHeading && <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{resolvedHeading}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {projectId != null
          ? t('scopedDescription')
          : t('globalDescription')}
      </div>

      {loading || catalogLoading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>{tc('loading')}</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {scoped.length === 0 && inherited.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noKeys')}</div>
          )}
          {scoped.map((c) => renderRow(c, false))}
          {inherited.map((c) => renderRow(c, true))}
        </div>
      )}

      {error && !adding && <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 10 }}>{error}</div>}

      {catalogLoading ? null : adding && formProviders.length > 0 ? (
        <CredentialKeyForm
          key={editing?.id ?? 'new'}
          providers={formProviders}
          editing={editing}
          saving={saving}
          serverError={error}
          onSave={(draft, rotating) => void save(draft, rotating)}
          onCancel={closeForm}
        />
      ) : offered.length > 0 ? (
        <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={() => setAdding(true)}>
          {t('addKey')}
        </button>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
          {catalogFailed ? t('catalogLoadError') : t('notConnectable')}
        </div>
      )}
    </div>
  );
}
