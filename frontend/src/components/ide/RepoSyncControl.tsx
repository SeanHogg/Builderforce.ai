'use client';

import { useEffect, useState } from 'react';
import { Select } from '@/components/Select';
import { ideRepoApi, type RepoSyncStatus } from '@/lib/api';
import { integrationsApi, type IntegrationCredential } from '@/lib/builderforceApi';

/**
 * RepoSyncControl — the IDE's repo bridge UI. R2 is always the working store; this
 * adds optional git sync on top:
 *   • No repo linked → "Create repo" (clean remote repo + push the workspace) or a
 *     hint to connect an existing repo below.
 *   • Repo linked → "Import from repo" (pull files into the workspace) and
 *     "Commit & open PR" (push workspace edits back).
 *
 * Lives above SourceControlContent in the IDE settings panel. `onChanged` refreshes
 * the IDE file tree after an import.
 */
const btn: React.CSSProperties = {
  padding: '7px 12px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
};
const btnPrimary: React.CSSProperties = { ...btn, background: 'var(--coral-bright)', color: '#fff', border: 'none' };
const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', color: 'var(--text-primary)',
};

export function RepoSyncControl({ projectId, onChanged }: { projectId: number; onChanged?: () => void }) {
  const [status, setStatus] = useState<RepoSyncStatus | null>(null);
  const [busy, setBusy] = useState<'import' | 'commit' | 'create' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    if (!status?.repoId) return;
    setBusy('import'); setErr(null); setMsg(null);
    try {
      const r = await ideRepoApi.import(projectId, status.repoId);
      setMsg(`Imported ${r.imported} file(s) from ${r.ref}.`);
      onChanged?.();
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(null); }
  };

  const runCommit = async () => {
    if (!status?.repoId) return;
    setBusy('commit'); setErr(null); setMsg(null);
    try {
      const r = await ideRepoApi.commit(projectId, status.repoId);
      setMsg(r.prUrl ? `Pushed ${r.committed} file(s) — PR #${r.prNumber} opened.` : `Committed ${r.committed} file(s) to ${r.branch}.`);
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Commit failed'); }
    finally { setBusy(null); }
  };

  const runCreate = async () => {
    if (!repoName.trim() || !credId) return;
    setBusy('create'); setErr(null); setMsg(null);
    try {
      const r = await ideRepoApi.createRepo(projectId, { name: repoName.trim(), credentialId: credId, private: isPrivate });
      setMsg(`Created ${r.owner}/${r.repo} and pushed ${r.committed} file(s).`);
      setShowCreate(false); setRepoName('');
      onChanged?.();
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Create failed'); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
        Repository sync
      </div>

      {status?.linked ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Linked to <strong style={{ color: 'var(--text-primary)' }}>{status.owner}/{status.repo}</strong>
            {status.lastSyncedRef ? <> · last synced <code>{status.lastSyncedRef}</code></> : <> · not yet imported</>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btn} onClick={runImport} disabled={busy !== null}>
              {busy === 'import' ? 'Importing…' : '⬇ Import from repo'}
            </button>
            <button type="button" style={btnPrimary} onClick={runCommit} disabled={busy !== null}>
              {busy === 'commit' ? 'Committing…' : '⬆ Commit & open PR'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            No repo linked — your files live in the IDE workspace. Create a clean repo to go live, or connect an existing one below.
          </div>
          {!showCreate ? (
            <button type="button" style={btnPrimary} onClick={() => setShowCreate(true)}>+ Create repo</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
              <input style={input} placeholder="repository name" value={repoName} onChange={(e) => setRepoName(e.target.value)} />
              {creds.length > 0 ? (
                <Select style={input} value={credId} onChange={(e) => setCredId(e.target.value)}>
                  <option value="">Select a GitHub credential…</option>
                  {creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--amber, #f59e0b)' }}>
                  No GitHub credential found. Add one under Integrations first.
                </div>
              )}
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> Private repository
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" style={btn} onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="button" style={btnPrimary} onClick={runCreate} disabled={busy !== null || !repoName.trim() || !credId}>
                  {busy === 'create' ? 'Creating…' : 'Create & push'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 8 }}>{err}</div>}
    </div>
  );
}
