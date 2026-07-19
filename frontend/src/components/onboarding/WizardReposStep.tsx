'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { reposApi, type ProjectRepository } from '@/lib/builderforceApi';
import { Select } from '@/components/Select';

/**
 * Onboarding step: attach one-or-many source repositories (GitHub / GitLab /
 * Bitbucket / Azure DevOps) to the new project. Reuses the reposApi (which binds
 * a repo to `project_repositories`); credential linking for private repos is
 * finished in Integrations, but the repo can be attached now so the audit knows
 * what to scan. Supports multiple repos with a default toggle.
 */
const PROVIDERS = [
  { id: 'github', label: 'GitHub', host: 'github.com' },
  { id: 'gitlab', label: 'GitLab', host: 'gitlab.com' },
  { id: 'bitbucket', label: 'Bitbucket', host: 'bitbucket.org' },
  { id: 'azure', label: 'Azure DevOps', host: 'dev.azure.com' },
];

export function WizardReposStep({ projectId }: { projectId: number }) {
  const t = useTranslations('onboarding.repos');
  const [repos, setRepos] = useState<ProjectRepository[]>([]);
  const [provider, setProvider] = useState('github');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    reposApi.list(projectId).then((r) => { if (live) setRepos(r); }).catch(() => {});
    return () => { live = false; };
  }, [projectId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!owner.trim() || !repo.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const host = PROVIDERS.find((p) => p.id === provider)?.host;
      const added = await reposApi.add(projectId, { provider, owner: owner.trim(), repo: repo.trim(), host, isDefault: repos.length === 0 });
      setRepos((prev) => [...prev, added]);
      setOwner(''); setRepo('');
    } catch {
      setError(t('errAdd'));
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async (id: string) => {
    try {
      await reposApi.setDefault(id);
      setRepos((prev) => prev.map((r) => ({ ...r, isDefault: r.id === id })));
    } catch { /* non-fatal */ }
  };

  const remove = async (id: string) => {
    try { await reposApi.remove(id); setRepos((prev) => prev.filter((r) => r.id !== id)); } catch { /* non-fatal */ }
  };

  const inputStyle: React.CSSProperties = {
    padding: '9px 12px', fontSize: 14, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
    borderRadius: 8, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>{t('intro')}</p>

      {repos.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {repos.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                {r.provider}: {r.owner}/{r.repo}
              </span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {r.isDefault ? (
                  <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>{t('default')}</span>
                ) : (
                  <button type="button" onClick={() => makeDefault(r.id)} style={{ fontSize: 11, background: 'none', border: 'none', color: 'var(--coral-bright)', cursor: 'pointer', padding: 0 }}>{t('makeDefault')}</button>
                )}
                <button type="button" onClick={() => remove(r.id)} aria-label={t('remove')} style={{ fontSize: 14, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>×</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 0.8fr) 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
        {/* Themed Select, not a native <select>: the native popup ignores our dark
            theme tokens and paints white-on-blue. See components/Select.tsx. */}
        <Select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ ...inputStyle, width: '100%' }} aria-label={t('provider')}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={t('ownerPlaceholder')} style={inputStyle} aria-label={t('owner')} />
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={t('repoPlaceholder')} style={inputStyle} aria-label={t('repo')} />
        <button type="submit" disabled={busy || !owner.trim() || !repo.trim()} style={{
          padding: '9px 16px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none',
          background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff',
          cursor: busy || !owner.trim() || !repo.trim() ? 'not-allowed' : 'pointer', opacity: busy || !owner.trim() || !repo.trim() ? 0.6 : 1,
        }}>{busy ? t('adding') : t('add')}</button>
      </form>
      {error && <p style={{ color: 'var(--error-text, #e74c3c)', fontSize: 13, marginTop: 10 }}>{error}</p>}
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>{t('privateHint')}</p>
    </div>
  );
}
