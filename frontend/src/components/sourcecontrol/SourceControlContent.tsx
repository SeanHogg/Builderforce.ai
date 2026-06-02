'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  reposApi,
  integrationsApi,
  type ProjectRepository,
  type IntegrationCredential,
} from '@/lib/builderforceApi';

/**
 * Project "Source control" tab — manage the repositories a project's agents
 * operate on. Each repo can be bound to an integration credential (project or
 * workspace-global) so the git-proxy can authenticate. Replaces the old
 * read-only stub that lived on the Project details tab.
 */

const SCM_PROVIDERS = ['github', 'gitlab', 'bitbucket'] as const;

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

export function SourceControlContent({ projectId }: { projectId: number }) {
  const [repos, setRepos] = useState<ProjectRepository[]>([]);
  const [creds, setCreds] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add-form state
  const [provider, setProvider] = useState<string>('github');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      reposApi.list(projectId),
      // credential picker offers both project-scoped and workspace-global keys
      Promise.all([integrationsApi.list({ projectId }), integrationsApi.list({ scope: 'global' })])
        .then(([a, b]) => [...a, ...b]),
    ])
      .then(([r, c]) => { setRepos(r); setCreds(c); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load repositories'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setProvider('github'); setOwner(''); setRepo(''); setDefaultBranch(''); setCredentialId(''); setIsDefault(false);
  };

  const add = async () => {
    if (!owner.trim() || !repo.trim()) { setError('Owner and repo are required'); return; }
    setSaving(true); setError(null);
    try {
      await reposApi.add(projectId, {
        provider,
        owner: owner.trim(),
        repo: repo.trim(),
        defaultBranch: defaultBranch.trim() || null,
        credentialId: credentialId || null,
        isDefault,
      });
      resetForm(); setAdding(false); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add repository');
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (id: string) => { await reposApi.setDefault(id); load(); };
  const remove = async (id: string) => { if (confirm('Remove this repository from the project?')) { await reposApi.remove(id); load(); } };

  const credName = (id: string | null) => creds.find((c) => c.id === id)?.name;

  // SCM credentials only (github/gitlab/bitbucket) for the picker
  const scmCreds = creds.filter((c) => (SCM_PROVIDERS as readonly string[]).includes(c.provider));

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Repositories</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Repositories this project&apos;s agents can read and open pull requests against. Bind each repo to a key
        configured in the Integrations tab (or a workspace-wide key).
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>Loading…</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {repos.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No repositories configured yet.</div>}
          {repos.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', minWidth: 70 }}>{r.provider}</span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
                {r.owner}/{r.repo}
                {r.defaultBranch && <span style={{ color: 'var(--text-muted)' }}> · {r.defaultBranch}</span>}
                {r.isDefault && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--coral-bright)' }}>default</span>}
                {r.credentialId
                  ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>🔑 {credName(r.credentialId) ?? 'key'}</span>
                  : <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--danger, #dc2626)' }}>no key</span>}
              </span>
              {!r.isDefault && <button type="button" style={btnSubtle} onClick={() => setDefault(r.id)}>Set default</button>}
              <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(r.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 10 }}>{error}</div>}

      {adding ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--bg-deep)', borderRadius: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ ...inputStyle, width: 130 }}>
              {SCM_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input style={inputStyle} placeholder="owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
            <input style={inputStyle} placeholder="repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
          </div>
          <input style={inputStyle} placeholder="default branch (optional, e.g. main)" value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
          <select value={credentialId} onChange={(e) => setCredentialId(e.target.value)} style={inputStyle}>
            <option value="">— Select access key —</option>
            {scmCreds.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.provider}{c.projectId == null ? ', workspace' : ''})</option>
            ))}
          </select>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Set as the project&apos;s default repository
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btnPrimary} disabled={saving} onClick={add}>{saving ? 'Adding…' : 'Add repository'}</button>
            <button type="button" style={btnSubtle} onClick={() => { setAdding(false); resetForm(); setError(null); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={() => setAdding(true)}>Add repository</button>
      )}
    </div>
  );
}
