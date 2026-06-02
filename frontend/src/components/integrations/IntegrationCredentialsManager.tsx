'use client';

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
}

export const PROVIDER_META: Record<IntegrationProvider, ProviderMeta> = {
  github: { label: 'GitHub', baseUrl: false, secrets: [{ key: 'accessToken', label: 'Personal access token', placeholder: 'ghp_…' }] },
  gitlab: { label: 'GitLab', baseUrl: 'optional', secrets: [{ key: 'accessToken', label: 'Personal access token', placeholder: 'glpat-…' }] },
  bitbucket: { label: 'Bitbucket', baseUrl: false, secrets: [{ key: 'accessToken', label: 'Access token' }] },
  jira: { label: 'Jira', baseUrl: 'required', secrets: [{ key: 'email', label: 'Account email', type: 'text' }, { key: 'apiToken', label: 'API token' }] },
  confluence: { label: 'Confluence', baseUrl: 'required', secrets: [{ key: 'email', label: 'Account email', type: 'text' }, { key: 'apiToken', label: 'API token' }] },
  freshservice: { label: 'Freshservice', baseUrl: 'required', secrets: [{ key: 'apiKey', label: 'API key' }] },
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

export function IntegrationCredentialsManager({ projectId, providers, heading = 'Integration keys' }: IntegrationCredentialsManagerProps) {
  const role = getStoredTenant()?.role;
  const canManage = role === 'owner' || role === 'manager';

  const providerList = providers ?? (Object.keys(PROVIDER_META) as IntegrationProvider[]);

  const [scoped, setScoped] = useState<IntegrationCredential[]>([]);
  const [inherited, setInherited] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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
      .then(([s, i]) => { setScoped(s); setInherited(i); })
      .catch(() => setError('Could not load integration keys.'))
      .finally(() => setLoading(false));
  }, [canManage, projectId]);

  useEffect(() => { load(); }, [load]);

  if (!canManage) return null;

  const meta = PROVIDER_META[provider];

  const resetForm = () => {
    setName(''); setBaseUrl(''); setSecrets({}); setProvider(providerList[0]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const missing = meta.secrets.find((f) => !secrets[f.key]?.trim());
      if (missing) { setError(`${missing.label} is required`); setSaving(false); return; }
      if (meta.baseUrl === 'required' && !baseUrl.trim()) { setError('Base URL is required'); setSaving(false); return; }
      await integrationsApi.create({
        provider,
        name: name.trim() || `${meta.label} key`,
        baseUrl: meta.baseUrl ? baseUrl.trim() || null : null,
        projectId: projectId ?? null,
        credentials: secrets,
      });
      resetForm();
      setAdding(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
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
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, message: e instanceof Error ? e.message : 'Test failed' } }));
    } finally {
      setTesting(null);
      load();
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this integration key?')) return;
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
          {readOnly && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>(workspace)</span>}
        </span>
        {ok != null && (
          <span style={{ fontSize: 11, color: ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>
            {ok ? '● connected' : '● failed'}
          </span>
        )}
        {result && !result.ok && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{result.message}</span>}
        {!readOnly && (
          <>
            <button type="button" style={btnSubtle} disabled={testing === c.id} onClick={() => test(c.id)}>
              {testing === c.id ? 'Testing…' : 'Test'}
            </button>
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(c.id)}>
              Delete
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={cardStyle}>
      {heading && <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{heading}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {projectId != null
          ? 'Keys scoped to this project. Workspace-wide keys are inherited and shown below.'
          : 'Keys available to every project in this workspace.'}
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>Loading…</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {scoped.length === 0 && inherited.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No keys configured yet.</div>
          )}
          {scoped.map((c) => renderRow(c, false))}
          {inherited.map((c) => renderRow(c, true))}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 10 }}>{error}</div>}

      {adding ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--bg-deep)', borderRadius: 10 }}>
          <select
            value={provider}
            onChange={(e) => { setProvider(e.target.value as IntegrationProvider); setSecrets({}); }}
            style={inputStyle}
          >
            {providerList.map((p) => (
              <option key={p} value={p}>{PROVIDER_META[p].label}</option>
            ))}
          </select>
          <input style={inputStyle} placeholder="Label (e.g. Production GitHub)" value={name} onChange={(e) => setName(e.target.value)} />
          {meta.baseUrl && (
            <input
              style={inputStyle}
              placeholder={meta.baseUrl === 'required' ? 'Base URL (required)' : 'Base URL (optional, e.g. https://gitlab.example.com)'}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          )}
          {meta.secrets.map((f) => (
            <input
              key={f.key}
              style={inputStyle}
              type={f.type === 'text' ? 'text' : 'password'}
              placeholder={f.placeholder ?? f.label}
              value={secrets[f.key] ?? ''}
              onChange={(e) => setSecrets((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btnPrimary} disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save key'}
            </button>
            <button type="button" style={btnSubtle} onClick={() => { setAdding(false); resetForm(); setError(null); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={() => setAdding(true)}>
          Add key
        </button>
      )}
    </div>
  );
}
