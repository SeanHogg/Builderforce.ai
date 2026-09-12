'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { ideRepoApi, type RepoSyncStatus } from '@/lib/api';
import { integrationsApi, type IntegrationCredential } from '@/lib/builderforceApi';
import { usePanelTask } from '@/hooks/usePanelTask';
/**
 * RepoSyncControl — Builder's repo bridge UI. R2 is always the working store; this
 * adds optional git sync on top:
 *   • No repo linked → "Create repo" (clean remote repo + push the workspace) or a
 *     hint to connect an existing repo below.
 *   • Repo linked → "Import from repo" (pull files into the workspace) and
 *     "Commit & open PR" (push workspace edits back).
 *
 * Lives above SourceControlContent in Builder settings. `onChanged` refreshes
 * the Builder file tree after an import.
 */
const btn: React.CSSProperties = {
  padding: '7px 12px', fontSize: 13, fontWeight: 600, borderRadius: 'var(--radius-md)', cursor: 'pointer',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
};
const btnPrimary: React.CSSProperties = { ...btn, background: 'var(--coral-bright)', color: 'var(--text-on-accent)', border: 'none' };
const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 'var(--radius-md)', boxSizing: 'border-box',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', color: 'var(--text-primary)',
};

export function RepoSyncControl({ projectId, onChanged }: { projectId: number; onChanged?: () => void }) {
  const t = useTranslations('repoSync');
  const tc = useTranslations('common');
  const [status, setStatus] = useState<RepoSyncStatus | null>(null);
  // `usePanelTask` already reduces a rejection to the reader's-language sentence
  // (`useErrorMessage`), so no call here re-translates it.
  const { busy, error: err, run: runTask } = usePanelTask();
  // Which action the in-flight task is — only so the right button says "…ing".
  const [pending, setPending] = useState<'import' | 'commit' | 'create' | null>(null);
  const busyAs = busy ? pending : null;
  // Every success line here names what the call RETURNED (file counts, the PR, the new
  // repo), which `run`'s up-front `success` cannot carry — so the notice stays local and
  // is cleared at the same moment `run` clears the error.
  const [msg, setMsg] = useState<string | null>(null);

  // Create-repo form (shown only when no repo is linked).
  const [creds, setCreds] = useState<IntegrationCredential[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [credId, setCredId] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);

  const reload = () => ideRepoApi.status(projectId).then(setStatus).catch(() => setStatus({ linked: false }));
  useEffect(() => { reload(); }, [projectId]);
  useEffect(() => {
    // GitHub credentials power "Create repo" (the only provider that can create today).
    integrationsApi.list().then((list) => setCreds(list.filter((c) => c.provider === 'github' && c.isEnabled))).catch(() => setCreds([]));
  }, [projectId]);

  const runImport = async () => {
    const repoId = status?.repoId;
    if (!repoId) return;
    setPending('import'); setMsg(null);
    const r = await runTask(() => ideRepoApi.import(projectId, repoId));
    if (r === undefined) return;
    setMsg(t('imported', { count: r.imported, ref: r.ref }));
    onChanged?.();
    reload();
  };

  const runCommit = async () => {
    const repoId = status?.repoId;
    if (!repoId) return;
    setPending('commit'); setMsg(null);
    const r = await runTask(() => ideRepoApi.commit(projectId, repoId));
    if (r === undefined) return;
    setMsg(r.prUrl
      ? t('pushedPr', { count: r.committed, pr: r.prNumber ?? '' })
      : t('committed', { count: r.committed, branch: r.branch }));
    reload();
  };

  const runCreate = async () => {
    if (!repoName.trim() || !credId) return;
    setPending('create'); setMsg(null);
    const r = await runTask(
      () => ideRepoApi.createRepo(projectId, { name: repoName.trim(), credentialId: credId, private: isPrivate }),
    );
    if (r === undefined) return;
    setMsg(t('created', { repo: `${r.owner}/${r.repo}`, count: r.committed }));
    setShowCreate(false); setRepoName('');
    onChanged?.();
    reload();
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
        {t('title')}
      </div>

      {status?.linked ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t.rich('linkedTo', {
              repo: `${status.owner}/${status.repo}`,
              strong: (chunks) => <strong style={{ color: 'var(--text-primary)' }}>{chunks}</strong>,
            })}
            {status.lastSyncedRef
              ? t.rich('lastSynced', { ref: status.lastSyncedRef, code: (chunks) => <code>{chunks}</code> })
              : t('notImported')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btn} onClick={runImport} disabled={busy}>
              {busyAs === 'import' ? t('importing') : t('import')}
            </button>
            <button type="button" style={btnPrimary} onClick={runCommit} disabled={busy}>
              {busyAs === 'commit' ? t('committing') : t('commit')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('noRepo')}
          </div>
          {!showCreate ? (
            <button type="button" style={btnPrimary} onClick={() => setShowCreate(true)}>{t('createRepo')}</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
              <input style={input} placeholder={t('repoNamePlaceholder')} value={repoName} onChange={(e) => setRepoName(e.target.value)} />
              {creds.length > 0 ? (
                <Select style={input} value={credId} onChange={(e) => setCredId(e.target.value)}>
                  <option value="">{t('selectCredential')}</option>
                  {creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--warning)' }}>
                  {t('noCredential')}
                </div>
              )}
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> {t('private')}
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" style={btn} onClick={() => setShowCreate(false)}>{tc('cancel')}</button>
                <button type="button" style={btnPrimary} onClick={runCreate} disabled={busy || !repoName.trim() || !credId}>
                  {busyAs === 'create' ? t('creating') : t('createAndPush')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
    </div>
  );
}
