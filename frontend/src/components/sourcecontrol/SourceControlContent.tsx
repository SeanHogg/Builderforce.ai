'use client';

import { Select } from '@/components/Select';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';

import { useCallback, useEffect, useState } from 'react';
import {
  reposApi,
  integrationsApi,
  type ProjectRepository,
  type IntegrationCredential,
} from '@/lib/builderforceApi';
import { saveFile } from '@/lib/api';
import { parseRepoIdentifier, isValidRepoSegment } from '@/lib/repoIdentifier';
import { formatRepoDiagnostic } from '@/lib/repoDiagnostic';
import { useGithubActionsReadiness } from '@/components/repos/githubActionsSurface';

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
  // Keeps every action in this row a comfortable tap target on a phone.
  minHeight: 32,
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

export function SourceControlContent({
  projectId,
  onImported,
}: {
  projectId: number;
  /** Called after a repo is imported into the IDE workspace, so the IDE can
   *  refresh its file tree to show the imported files. */
  onImported?: () => void;
}) {
  const confirm = useConfirm();
  const tc = useTranslations('common');
  const t = useTranslations('sourceControl');
  const [repos, setRepos] = useState<ProjectRepository[]>([]);
  const [creds, setCreds] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  // Two maintenance actions that used to be API-only (an operator had to POST
  // them by hand): committing the agent workflow, and backfilling security alerts
  // for a repo connected after its alerts had accumulated.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  // Shared with the cloud-agent surface picker, so "enabled" means exactly one
  // thing across the app.
  const { status: actionsStatus, refresh: refreshActions } = useGithubActionsReadiness(projectId);

  // Add/edit-form state (shared between linking a new repo and editing one)
  const [provider, setProvider] = useState<string>('github');
  const [host, setHost] = useState('');
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
      .catch((e) => setError(e instanceof Error ? e.message : t('errLoad')))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setProvider('github'); setHost(''); setOwner(''); setRepo(''); setDefaultBranch(''); setCredentialId(''); setIsDefault(false);
  };

  const closeForm = () => { setAdding(false); setEditingId(null); resetForm(); setError(null); };

  const openAdd = () => { resetForm(); setEditingId(null); setError(null); setAdding(true); };

  const openEdit = (r: ProjectRepository) => {
    setProvider(r.provider);
    // Only surface a non-default host (github.com is the implicit default).
    setHost(r.host && r.host !== 'github.com' ? r.host : '');
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
    if (parsed) {
      setOwner(parsed.owner);
      setRepo(parsed.repo);
      // An enterprise host parsed out of a pasted URL prefills the host box so the
      // probe targets the right server instead of defaulting to github.com.
      if (parsed.host && parsed.host !== 'github.com') setHost(parsed.host);
    } else setOwner(value);
  };

  const submit = async () => {
    const o = owner.trim();
    const r = repo.trim();
    if (!o || !r) { setError(t('errOwnerRepoRequired')); return; }
    // Each box is a single path segment — reject a URL / slashes / spaces and say
    // what's expected (the most common cause of the GitHub 404 on Test).
    if (!isValidRepoSegment(o) || !isValidRepoSegment(r)) {
      setError(t('errInvalidSegment'));
      return;
    }
    setSaving(true); setError(null);
    try {
      const payload = {
        provider,
        // Empty → undefined so the backend keeps its github.com default.
        host: host.trim() || undefined,
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
      setError(e instanceof Error ? e.message : (editingId ? t('errUpdate') : t('errAdd')));
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (id: string) => { await reposApi.setDefault(id); load(); };
  const remove = async (id: string) => { if (await confirm(tc('removeRepositoryConfirm'))) { await reposApi.remove(id); load(); } };

  // Copy a secret-free config snapshot (incl. the reconstructed probe URL + the
  // latest test result) to the clipboard, for pasting into a bug report so a
  // maintainer can diagnose a failed Test (e.g. a GitHub 404) without guessing.
  const copyConfig = async (r: ProjectRepository) => {
    const cred = creds.find((c) => c.id === r.credentialId) ?? null;
    const text = formatRepoDiagnostic(
      r,
      cred ? { name: cred.name, provider: cred.provider, baseUrl: cred.baseUrl } : null,
      testResult[r.id] ?? null,
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(r.id);
      setTimeout(() => setCopiedId((cur) => (cur === r.id ? null : cur)), 2000);
    } catch {
      setError(t('errClipboard'));
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    try {
      const res = await reposApi.test(id);
      setTestResult((prev) => ({ ...prev, [id]: res }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, message: e instanceof Error ? e.message : t('testFailed') } }));
    } finally {
      setTesting(null);
    }
  };

  // Pull the repo's files into the IDE workspace. The server reads them with the
  // tenant's token; we persist each via saveFile (which targets whichever storage
  // backend the IDE reads from), then ask the IDE to refresh its file tree.
  const importRepo = async (r: ProjectRepository) => {
    if (!r.credentialId) {
      setImportResult((p) => ({ ...p, [r.id]: { ok: false, message: t('linkKeyFirst') } }));
      return;
    }
    setImporting(r.id);
    setImportResult((p) => ({ ...p, [r.id]: { ok: true, message: t('readingRepo') } }));
    try {
      const manifest = await reposApi.contents(r.id, r.defaultBranch ?? undefined);
      if (manifest.files.length === 0) {
        setImportResult((p) => ({ ...p, [r.id]: { ok: false, message: t('noImportableFiles') } }));
        return;
      }
      let written = 0;
      for (const f of manifest.files) {
        await saveFile(projectId, f.path, f.content);
        written++;
        setImportResult((p) => ({ ...p, [r.id]: { ok: true, message: t('importingProgress', { written, total: manifest.files.length }) } }));
      }
      const suffix = manifest.truncated ? t('importCapped', { written, discovered: manifest.discovered }) : '';
      setImportResult((p) => ({ ...p, [r.id]: { ok: true, message: t('importedFiles', { count: written, suffix }) } }));
      onImported?.();
    } catch (e) {
      setImportResult((p) => ({ ...p, [r.id]: { ok: false, message: e instanceof Error ? e.message : t('importFailed') } }));
    } finally {
      setImporting(null);
    }
  };

  /**
   * Commit the Builderforce agent workflow into the repo's default branch — what
   * makes the `github_actions` execution surface actually runnable for this
   * project. Re-running it REWRITES a file the user is explicitly invited to edit,
   * so re-enabling an already-enabled repo asks first; the first-time enable does
   * not (there is nothing to overwrite).
   */
  const enableAgentRuns = async (r: ProjectRepository) => {
    const already = actionsStatus?.repositories.find((s) => s.repoId === r.id)?.enabled ?? false;
    if (already && !(await confirm(t('confirmReenableActions')))) return;
    setBusyAction(`actions:${r.id}`);
    try {
      const res = await reposApi.enableGithubActions(r.id);
      setActionResult((p) => ({ ...p, [r.id]: { ok: true, message: t('actionsEnabled', { path: res.path }) } }));
      refreshActions();
    } catch (e) {
      // The overwhelmingly common failure is a credential without the `workflow`
      // scope, and the server says so verbatim — surface it rather than flatten it.
      setActionResult((p) => ({ ...p, [r.id]: { ok: false, message: e instanceof Error ? e.message : t('actionsEnableFailed') } }));
    } finally {
      setBusyAction(null);
    }
  };

  /** Pull every OPEN code-scanning / Dependabot alert in as a security finding.
   *  Idempotent server-side (ingestion dedupes), so this needs no confirmation. */
  const backfillAlerts = async (r: ProjectRepository) => {
    setBusyAction(`alerts:${r.id}`);
    try {
      const res = await reposApi.backfillSecurityAlerts(r.id);
      setActionResult((p) => ({ ...p, [r.id]: { ok: true, message: t('alertsBackfilled', { count: res.ingested ?? 0, deduped: res.deduped ?? 0 }) } }));
    } catch (e) {
      setActionResult((p) => ({ ...p, [r.id]: { ok: false, message: e instanceof Error ? e.message : t('alertsBackfillFailed') } }));
    } finally {
      setBusyAction(null);
    }
  };

  const credName = (id: string | null) => creds.find((c) => c.id === id)?.name;

  // SCM credentials only (github/gitlab/bitbucket) for the picker
  const scmCreds = creds.filter((c) => (SCM_PROVIDERS as readonly string[]).includes(c.provider));

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{t('repositories')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {t('intro')}
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>{tc('loading')}</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {repos.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noRepos')}</div>}
          {repos.map((r) => {
            const result = testResult[r.id];
            const imp = importResult[r.id];
            const act = actionResult[r.id];
            const ghStatus = actionsStatus?.repositories.find((s) => s.repoId === r.id);
            return (
              // flexWrap keeps the action row from overflowing on a phone: the
              // buttons stack onto their own lines instead of forcing a sideways
              // scroll of the whole panel.
              <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', minWidth: 70 }}>{r.provider}</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
                  {r.owner}/{r.repo}
                  {r.defaultBranch && <span style={{ color: 'var(--text-muted)' }}> · {r.defaultBranch}</span>}
                  {r.isDefault && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--coral-bright)' }}>{t('defaultBadge')}</span>}
                  {r.credentialId
                    ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>🔑 {credName(r.credentialId) ?? t('key')}</span>
                    : <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--danger, #dc2626)' }}>{t('noKey')}</span>}
                </span>
                {result && (
                  <span style={{ fontSize: 11, color: result.ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>
                    ● {result.message}
                  </span>
                )}
                {imp && (
                  <span style={{ fontSize: 11, color: imp.ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>
                    ● {imp.message}
                  </span>
                )}
                {act && (
                  <span style={{ fontSize: 11, color: act.ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)', flexBasis: '100%' }}>
                    ● {act.message}
                  </span>
                )}
                <button type="button" style={btnSubtle} disabled={testing === r.id} onClick={() => test(r.id)}>
                  {testing === r.id ? t('testing') : t('test')}
                </button>
                <button
                  type="button"
                  style={btnSubtle}
                  disabled={importing === r.id}
                  title={t('importTitle')}
                  onClick={() => importRepo(r)}
                >
                  {importing === r.id ? t('importing') : t('importToIde')}
                </button>
                <button
                  type="button"
                  style={btnSubtle}
                  title={t('copyConfigTitle')}
                  onClick={() => copyConfig(r)}
                >
                  {copiedId === r.id ? t('copied') : t('copy')}
                </button>
                {/* Only GitHub has Actions — a GitLab/Bitbucket repo has nothing
                    to enable, so the affordance simply isn't there. */}
                {ghStatus?.supported && (
                  <button
                    type="button"
                    style={btnSubtle}
                    disabled={busyAction === `actions:${r.id}`}
                    title={ghStatus.enabled ? t('reenableAgentRunsTitle') : t('enableAgentRunsTitle')}
                    onClick={() => enableAgentRuns(r)}
                  >
                    {busyAction === `actions:${r.id}`
                      ? t('enablingAgentRuns')
                      : ghStatus.enabled ? t('agentRunsEnabled') : t('enableAgentRuns')}
                  </button>
                )}
                {ghStatus?.supported && (
                  <button
                    type="button"
                    style={btnSubtle}
                    disabled={busyAction === `alerts:${r.id}`}
                    title={t('backfillAlertsTitle')}
                    onClick={() => backfillAlerts(r)}
                  >
                    {busyAction === `alerts:${r.id}` ? t('backfillingAlerts') : t('backfillAlerts')}
                  </button>
                )}
                {!r.isDefault && <button type="button" style={btnSubtle} onClick={() => setDefault(r.id)}>{t('setDefault')}</button>}
                <button type="button" style={iconBtn} title={t('editRepository')} aria-label={t('editRepository')} onClick={() => openEdit(r)}>
                  <PencilIcon />
                </button>
                <button type="button" style={{ ...iconBtn, color: 'var(--danger, #dc2626)' }} title={t('removeRepository')} aria-label={t('removeRepository')} onClick={() => remove(r.id)}>
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
            <input style={inputStyle} placeholder={t('ownerPlaceholder')} value={owner} onChange={(e) => onOwnerChange(e.target.value)} />
            <input style={inputStyle} placeholder={t('repoPlaceholder')} value={repo} onChange={(e) => setRepo(e.target.value)} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4 }}>
            {t.rich('ownerRepoHelp', { code: (c) => <code>{c}</code>, em: (c) => <em>{c}</em> })}
          </div>
          <input style={inputStyle} placeholder={t('hostPlaceholder')} value={host} onChange={(e) => setHost(e.target.value)} />
          <input style={inputStyle} placeholder={t('branchPlaceholder')} value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
          <Select value={credentialId} onChange={(e) => setCredentialId(e.target.value)} style={inputStyle}>
            <option value="">{t('selectAccessKey')}</option>
            {scmCreds.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.provider}{c.projectId == null ? t('workspaceSuffix') : ''})</option>
            ))}
          </Select>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            {t('setAsDefault')}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btnPrimary} disabled={saving} onClick={submit}>
              {saving ? tc('saving') : editingId ? t('saveChanges') : t('addRepository')}
            </button>
            <button type="button" style={btnSubtle} onClick={closeForm}>{tc('cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={openAdd}>{t('addRepository')}</button>
      )}
    </div>
  );
}
