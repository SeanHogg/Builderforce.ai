'use client';

import { Select } from '@/components/Select';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';

import { useCallback, useEffect, useState } from 'react';
import {
  integrationsApi,
  type IntegrationCredential,
  type IntegrationProvider,
} from '@/lib/builderforceApi';
import { getStoredTenant } from '@/lib/auth';

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
 * Self-gating on role (owner/manager) — writes are also role-gated server-side
 * (requireRole(MANAGER)), so callers need no `canManage` prop.
 */

interface SecretField {
  key: string;
  label: string;
  /** 'text' for non-secret fields like an email; defaults to password. */
  type?: 'text' | 'password';
  placeholder?: string;
}

interface ProviderMeta {
  label: string;
  secrets: SecretField[];
  /** Whether a base URL is needed: 'required', 'optional', or false. */
  baseUrl: 'required' | 'optional' | false;
  /**
   * Present when this provider can be connected as a synced board. Drives the
   * BoardConnectionsManager picker + external-board-id hint so that surface
   * derives from this single source instead of its own provider list.
   */
  board?: { externalId: 'required' | 'optional'; hint: string };
}

export const PROVIDER_META: Record<IntegrationProvider, ProviderMeta> = {
  github: { label: 'GitHub', baseUrl: false, secrets: [{ key: 'accessToken', label: 'Personal access token', placeholder: 'ghp_…' }], board: { externalId: 'required', hint: 'Repository — owner/repo (e.g. octocat/hello-world)' } },
  gitlab: { label: 'GitLab', baseUrl: 'optional', secrets: [{ key: 'accessToken', label: 'Personal access token', placeholder: 'glpat-…' }] },
  bitbucket: { label: 'Bitbucket', baseUrl: false, secrets: [{ key: 'accessToken', label: 'Access token' }] },
  jira: { label: 'Jira', baseUrl: 'required', secrets: [{ key: 'email', label: 'Account email', type: 'text' }, { key: 'apiToken', label: 'API token' }], board: { externalId: 'optional', hint: 'Project key (e.g. ENG) — blank syncs all' } },
  confluence: { label: 'Confluence', baseUrl: 'required', secrets: [{ key: 'email', label: 'Account email', type: 'text' }, { key: 'apiToken', label: 'API token' }] },
  freshservice: { label: 'Freshservice', baseUrl: 'required', secrets: [{ key: 'apiKey', label: 'API key' }], board: { externalId: 'optional', hint: 'Workspace ID (optional) — blank syncs all tickets' } },
  freshdesk: { label: 'Freshdesk', baseUrl: 'required', secrets: [{ key: 'apiKey', label: 'API key' }], board: { externalId: 'optional', hint: 'Freshdesk domain (e.g. https://yourco.freshdesk.com)' } },
  servicenow: { label: 'ServiceNow', baseUrl: 'required', secrets: [{ key: 'username', label: 'Username', type: 'text' }, { key: 'password', label: 'Password' }], board: { externalId: 'optional', hint: 'Table name (default: incident)' } },
  linear: { label: 'Linear', baseUrl: false, secrets: [{ key: 'apiKey', label: 'API key', placeholder: 'lin_api_…' }], board: { externalId: 'optional', hint: 'Team ID (optional) — blank syncs all teams' } },
  sentry: { label: 'Sentry', baseUrl: 'optional', secrets: [{ key: 'token', label: 'Auth token', placeholder: 'sntrys_…' }], board: { externalId: 'required', hint: 'organization-slug/project-slug' } },
  pagerduty: { label: 'PagerDuty', baseUrl: false, secrets: [{ key: 'apiToken', label: 'API token' }, { key: 'fromEmail', label: 'From email (for write-back)', type: 'text', placeholder: 'you@company.com' }], board: { externalId: 'optional', hint: 'Service ID (optional) — blank syncs all services' } },
  monday: { label: 'monday.com', baseUrl: false, secrets: [{ key: 'token', label: 'API token' }], board: { externalId: 'required', hint: 'Board ID (numeric)' } },
  asana: { label: 'Asana', baseUrl: false, secrets: [{ key: 'accessToken', label: 'Personal access token' }], board: { externalId: 'required', hint: 'Project GID' } },
  clickup: { label: 'ClickUp', baseUrl: false, secrets: [{ key: 'token', label: 'API token', placeholder: 'pk_…' }], board: { externalId: 'required', hint: 'List ID' } },
  // Not a board/ticket source: this key gives CLOUD AGENTS the `web_search` tool. They
  // can already read a URL you give them; a search key lets them find one. Search bills
  // per query, so the key is yours — with none saved, agents stay fetch-only.
  brave_search: { label: 'Brave Search (agent web search)', baseUrl: false, secrets: [{ key: 'apiKey', label: 'Subscription token', placeholder: 'BSA…' }] },
  // Google connectors — OAuth offline credentials (client id/secret + a refresh
  // token from Google's OAuth playground or your own consent flow). Gmail backs
  // the email workflow node; Drive can back a project's file storage.
  gmail: { label: 'Gmail', baseUrl: false, secrets: [
    { key: 'clientId', label: 'OAuth client ID', type: 'text', placeholder: '…apps.googleusercontent.com' },
    { key: 'clientSecret', label: 'OAuth client secret' },
    { key: 'refreshToken', label: 'OAuth refresh token' },
    { key: 'fromEmail', label: 'Send-as email', type: 'text', placeholder: 'you@gmail.com' },
  ] },
  google_drive: { label: 'Google Drive', baseUrl: false, secrets: [
    { key: 'clientId', label: 'OAuth client ID', type: 'text', placeholder: '…apps.googleusercontent.com' },
    { key: 'clientSecret', label: 'OAuth client secret' },
    { key: 'refreshToken', label: 'OAuth refresh token' },
    { key: 'rootFolderId', label: 'Root folder ID (optional)', type: 'text', placeholder: 'blank = Drive root' },
  ] },
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 20,
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600,
  background: 'var(--coral-bright)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};

const btnSubtle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, fontWeight: 600,
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};

export interface IntegrationCredentialsManagerProps {
  /** Omit for workspace-global keys; set to scope keys to a single project. */
  projectId?: number;
  /** Restrict the provider dropdown (e.g. source-control contexts). */
  providers?: IntegrationProvider[];
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

  const providerList = providers ?? (Object.keys(PROVIDER_META) as IntegrationProvider[]);
  // A stable primitive keeps the loader in sync when a gallery drawer switches
  // providers even though callers commonly pass a fresh one-item array.
  const providerFilterKey = providerList.join('|');

  const [scoped, setScoped] = useState<IntegrationCredential[]>([]);
  const [inherited, setInherited] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // When set, the add-form is in EDIT mode for this credential id (rotate key /
  // rename / change base URL) rather than creating a new one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  // Add-form state
  const [provider, setProvider] = useState<IntegrationProvider>(providerList[0]);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!canManage) return;
    setLoading(true);
    const scopedP = projectId != null
      ? integrationsApi.list({ projectId })
      : integrationsApi.list({ scope: 'global' });
    const inheritedP = projectId != null
      ? integrationsApi.list({ scope: 'global' })
      : Promise.resolve<IntegrationCredential[]>([]);
    Promise.all([scopedP, inheritedP])
      .then(([s, i]) => {
        setScoped(filterCredentialsByProvider(s, providerFilterKey));
        setInherited(filterCredentialsByProvider(i, providerFilterKey));
      })
      .catch(() => setError(t('loadError')))
      .finally(() => setLoading(false));
  }, [canManage, projectId, providerFilterKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setProvider(providerList[0]);
    setAdding(false);
    setEditingId(null);
  }, [providerFilterKey]);

  if (!canManage) return null;

  const meta = PROVIDER_META[provider];
  // undefined default → localized fallback heading; null → headerless; string → as given.
  const resolvedHeading = heading === undefined ? t('heading') : heading;

  const editing = editingId != null;

  const resetForm = () => {
    setName(''); setBaseUrl(''); setSecrets({}); setProvider(providerList[0]);
  };

  const closeForm = () => {
    setAdding(false); setEditingId(null); resetForm(); setError(null);
  };

  // Pre-fill the form to edit an existing key. Secrets are never returned in the
  // clear (GET masks them), so the token fields start blank: blank = keep the
  // current key, any value = rotate it. Provider can't change on an existing key.
  const openEdit = (c: IntegrationCredential) => {
    setProvider(c.provider);
    setName(c.name);
    setBaseUrl(c.baseUrl ?? '');
    setSecrets({});
    setEditingId(c.id);
    setError(null);
    setAdding(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (meta.baseUrl === 'required' && !baseUrl.trim()) { setError(t('baseUrlRequired')); setSaving(false); return; }
      // The credential blob is stored/replaced wholesale, so secrets are
      // all-or-nothing: required on create, and on edit only when rotating (if any
      // secret field is filled, every one must be, else we'd drop the others).
      const anySecret = meta.secrets.some((f) => secrets[f.key]?.trim());
      if (!editing || anySecret) {
        const missing = meta.secrets.find((f) => !secrets[f.key]?.trim());
        if (missing) {
          setError(editing ? t('rotateFieldMissing', { field: missing.label }) : t('fieldRequired', { field: missing.label }));
          setSaving(false); return;
        }
      }
      if (editingId !== null) {
        await integrationsApi.update(editingId, {
          name: name.trim() || t('defaultKeyName', { provider: meta.label }),
          baseUrl: meta.baseUrl ? baseUrl.trim() || null : null,
          ...(anySecret ? { credentials: secrets } : {}),
        });
      } else {
        await integrationsApi.create({
          provider,
          name: name.trim() || t('defaultKeyName', { provider: meta.label }),
          baseUrl: meta.baseUrl ? baseUrl.trim() || null : null,
          projectId: projectId ?? null,
          credentials: secrets,
        });
      }
      closeForm();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
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

  const remove = async (id: string) => {
    if (!(await confirm(tc('deleteIntegrationKeyConfirm')))) return;
    await integrationsApi.remove(id);
    load();
  };

  const renderRow = (c: IntegrationCredential, readOnly: boolean) => {
    const result = testResult[c.id];
    const ok = result ? result.ok : c.lastTestOk;
    return (
      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', minWidth: 78 }}>
          {PROVIDER_META[c.provider]?.label ?? c.provider}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
          {c.name}
          {readOnly && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{t('workspaceTag')}</span>}
        </span>
        {ok != null && (
          <span style={{ fontSize: 11, color: ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>
            {ok ? `● ${t('connected')}` : `● ${t('failed')}`}
          </span>
        )}
        {result && !result.ok && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{result.message}</span>}
        {!readOnly && (
          <>
            <button type="button" style={btnSubtle} disabled={testing === c.id} onClick={() => test(c.id)}>
              {testing === c.id ? t('testing') : t('test')}
            </button>
            <button type="button" style={btnSubtle} onClick={() => openEdit(c)}>
              {tc('edit')}
            </button>
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(c.id)}>
              {tc('delete')}
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={cardStyle}>
      {resolvedHeading && <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{resolvedHeading}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {projectId != null
          ? t('scopedDescription')
          : t('globalDescription')}
      </div>

      {loading ? (
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

      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 10 }}>{error}</div>}

      {adding ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--bg-deep)', borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{editing ? t('editKeyTitle', { provider: meta.label }) : t('addKeyTitle')}</div>
          <Select
            value={provider}
            onChange={(e) => { setProvider(e.target.value as IntegrationProvider); setSecrets({}); }}
            style={inputStyle}
            // Provider is fixed once a key exists — rotating/renaming only.
            disabled={editing}
          >
            {providerList.map((p) => (
              <option key={p} value={p}>{PROVIDER_META[p].label}</option>
            ))}
          </Select>
          <input style={inputStyle} placeholder={t('labelPlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
          {meta.baseUrl && (
            <input
              style={inputStyle}
              placeholder={meta.baseUrl === 'required' ? t('baseUrlRequiredPlaceholder') : t('baseUrlOptionalPlaceholder')}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          )}
          {meta.secrets.map((f) => (
            <input
              key={f.key}
              style={inputStyle}
              type={f.type === 'text' ? 'text' : 'password'}
              placeholder={editing ? t('secretEditPlaceholder', { field: f.label }) : (f.placeholder ?? f.label)}
              value={secrets[f.key] ?? ''}
              onChange={(e) => setSecrets((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          ))}
          {editing && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {meta.secrets.length > 1 ? t('rotateHintMulti') : t('rotateHintSingle')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btnPrimary} disabled={saving} onClick={save}>
              {saving ? tc('saving') : editing ? t('saveChanges') : t('saveKey')}
            </button>
            <button type="button" style={btnSubtle} onClick={closeForm}>
              {tc('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={() => setAdding(true)}>
          {t('addKey')}
        </button>
      )}
    </div>
  );
}
