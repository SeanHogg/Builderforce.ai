'use client';

import { Select } from '@/components/Select';

import { useCallback, useEffect, useState } from 'react';
import {
  reposApi,
  integrationsApi,
  type ProjectRepository,
  type IntegrationCredential,
} from '@/lib/builderforceApi';
import { parseRepoIdentifier, isValidRepoSegment } from '@/lib/repoIdentifier';

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
const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8,
  cursor: 'pointer', color: 'var(--text-secondary)', padding: 0,
};

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export function SourceControlContent({ projectId }: { projectId: number }) {
  const [repos, setRepos] = useState<ProjectRepository[]>([]);
  const [creds, setCreds] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  // Add/edit-form state (shared between linking a new repo and editing one)
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

  const closeForm = () => { setAdding(false); setEditingId(null); resetForm(); setError(null); };

  const openAdd = () => { resetForm(); setEditingId(null); setError(null); setAdding(true); };

  const openEdit = (r: ProjectRepository) => {
    setProvider(r.provider);
    setOwner(r.owner);
    setRepo(r.repo);
    setDefaultBranch(r.defaultBranch ?? '');
    setCredentialId(r.credentialId ?? '');
    setIsDefault(r.isDefault);
    setEditingId(r.id);
    setError(null);
    setAdding(true);
  };

  // Split a pasted URL / `owner/repo` into the two boxes so users don't end up
  // with a slash-laden owner that 404s the Test probe. Falls back to the raw
  // value when the paste isn't a recognizable owner/repo pair.
  const onOwnerChange = (value: string) => {
    const parsed = parseRepoIdentifier(value);
    if (parsed) { setOwner(parsed.owner); setRepo(parsed.repo); }
    else setOwner(value);
  };

  const submit = async () => {
    const o = owner.trim();
    const r = repo.trim();
    if (!o || !r) { setError('Owner and repo are required.'); return; }
    // Each box is a single path segment — reject a URL / slashes / spaces and say
    // what's expected (the most common cause of the GitHub 404 on Test).
    if (!isValidRepoSegment(o) || !isValidRepoSegment(r)) {
      setError('Enter owner and repo as separate names, not a URL — e.g. for https://github.com/acme/app, owner = "acme", repo = "app". Letters, numbers, ".", "_" and "-" only.');
      return;
    }
    setSaving(true); setError(null);
    try {
      const payload = {
        provider,
        owner: owner.trim(),
        repo: repo.trim(),
        defaultBranch: defaultBranch.trim() || null,
        // '' (the "no key" option) must become null so the binding clears /
        // switches cleanly — an empty string would be rejected by the uuid FK.
        credentialId: credentialId || null,
        isDefault,
      };
      if (editingId) await reposApi.update(editingId, payload);
      else await reposApi.add(projectId, payload);
      closeForm(); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${editingId ? 'update' : 'add'} repository`);
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (id: string) => { await reposApi.setDefault(id); load(); };
  const remove = async (id: string) => { if (confirm('Remove this repository from the project?')) { await reposApi.remove(id); load(); } };

  const test = async (id: string) => {
    setTesting(id);
    try {
      const res = await reposApi.test(id);
      setTestResult((prev) => ({ ...prev, [id]: res }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, message: e instanceof Error ? e.message : 'Test failed' } }));
    } finally {
      setTesting(null);
    }
  };

  const credName = (id: string | null) => creds.find((c) => c.id === id)?.name;

  // SCM credentials only (github/gitlab/bitbucket) for the picker
  const scmCreds = creds.filter((c) => (SCM_PROVIDERS as readonly string[]).includes(c.provider));

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Repositories</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Repositories this project&apos;s agents can read and open pull requests against. Bind each repo to a
        project integration key (above) or a workspace-wide key.
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>Loading…</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {repos.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No repositories configured yet.</div>}
          {repos.map((r) => {
            const result = testResult[r.id];
            return (
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
                {result && (
                  <span style={{ fontSize: 11, color: result.ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>
                    ● {result.message}
                  </span>
                )}
                <button type="button" style={btnSubtle} disabled={testing === r.id} onClick={() => test(r.id)}>
                  {testing === r.id ? 'Testing…' : 'Test'}
                </button>
                {!r.isDefault && <button type="button" style={btnSubtle} onClick={() => setDefault(r.id)}>Set default</button>}
                <button type="button" style={iconBtn} title="Edit repository" aria-label="Edit repository" onClick={() => openEdit(r)}>
                  <PencilIcon />
                </button>
                <button type="button" style={{ ...iconBtn, color: 'var(--danger, #dc2626)' }} title="Remove repository" aria-label="Remove repository" onClick={() => remove(r.id)}>
                  <TrashIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 10 }}>{error}</div>}

      {adding ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--bg-deep)', borderRadius: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ ...inputStyle, width: 130 }}>
              {SCM_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <input style={inputStyle} placeholder="owner (e.g. acme)" value={owner} onChange={(e) => onOwnerChange(e.target.value)} />
            <input style={inputStyle} placeholder="repo (e.g. app)" value={repo} onChange={(e) => setRepo(e.target.value)} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4 }}>
            Owner and repo are separate names from the repo URL — for <code>https://github.com/acme/app</code>, owner is <code>acme</code> and repo is <code>app</code>. Paste a full URL into <em>owner</em> and we&apos;ll split it for you.
          </div>
          <input style={inputStyle} placeholder="default branch (optional, e.g. main)" value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
          <Select value={credentialId} onChange={(e) => setCredentialId(e.target.value)} style={inputStyle}>
            <option value="">— Select access key —</option>
            {scmCreds.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.provider}{c.projectId == null ? ', workspace' : ''})</option>
            ))}
          </Select>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Set as the project&apos;s default repository
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btnPrimary} disabled={saving} onClick={submit}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add repository'}
            </button>
            <button type="button" style={btnSubtle} onClick={closeForm}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={openAdd}>Add repository</button>
      )}
    </div>
  );
}
