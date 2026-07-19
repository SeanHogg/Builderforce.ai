'use client';

/**
 * GitHub Actions deploy — the CI half of the Publish tab.
 *
 * Publishing from the browser needs the IDE open and the WebContainer warm, and
 * it leaves no record of how the build was produced. Handing the build to GitHub
 * gives a build per commit, a real log, and a deploy that happens without anyone
 * watching — the same site either way, because both paths land in the shared
 * publish core server-side.
 *
 * Enabling writes a workflow into the user's own repo. That file is theirs to
 * read and edit, so it is shown here verbatim rather than described.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ideRepoApi, type RepoSyncStatus } from '@/lib/api';

interface GitHubDeployPanelProps {
  projectId: number;
  /** Subdomain the workflow should publish to; falls back to the project's own. */
  subdomain?: string;
}

export function GitHubDeployPanel({ projectId, subdomain }: GitHubDeployPanelProps) {
  const t = useTranslations('ide');
  const [repo, setRepo] = useState<RepoSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState<{ path: string; branch: string; workflow: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    ideRepoApi.status(projectId)
      .then((s) => { if (!cancelled) setRepo(s); })
      .catch(() => { if (!cancelled) setRepo(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const enable = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setEnabled(await ideRepoApi.enableDeploys(projectId, subdomain ? { subdomain } : {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('deploy.enableFailed'));
    } finally {
      setBusy(false);
    }
  }, [projectId, subdomain, t]);

  if (loading) {
    return <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('deploy.checking')}</div>;
  }

  const isGitHub = repo?.linked && repo.provider === 'github';
  const actionsUrl = repo?.owner && repo.repo
    ? `https://github.com/${repo.owner}/${repo.repo}/actions`
    : null;

  return (
    <section
      style={{
        borderTop: '1px solid var(--chat-input-border, var(--border-subtle))',
        paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
          {t('deploy.title')}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>
          {t('deploy.description')}
        </div>
      </div>

      {!isGitHub ? (
        // Not connected: say what to do rather than showing a button that 400s.
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {repo?.linked ? t('deploy.needsGitHub') : t('deploy.needsRepo')}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('deploy.repoLabel')} </span>
            <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>{repo.owner}/{repo.repo}</code>
          </div>

          <button
            type="button"
            onClick={enable}
            disabled={busy}
            style={{
              padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)',
              cursor: busy ? 'wait' : 'pointer', background: 'var(--bg-elevated)',
              color: 'var(--text-primary)', fontWeight: 600, fontSize: 13.5,
              fontFamily: 'var(--font-display)', alignSelf: 'flex-start',
            }}
          >
            {busy ? t('deploy.enabling') : enabled ? t('deploy.reapply') : t('deploy.enable')}
          </button>

          {error && (
            <div style={{ color: 'var(--error-text, #c0392b)', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
              {error}
            </div>
          )}

          {enabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {t('deploy.enabledOn', { path: enabled.path, branch: enabled.branch })}
              </div>
              {actionsUrl && (
                <a
                  href={actionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12.5, color: 'var(--coral-bright, #e2654a)', fontWeight: 600 }}
                >
                  {t('deploy.viewRuns')}
                </a>
              )}
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {t('deploy.viewWorkflow')}
                </summary>
                <pre
                  style={{
                    marginTop: 8, padding: 12, borderRadius: 8, overflowX: 'auto',
                    background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)', fontSize: 11.5, lineHeight: 1.5,
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  {enabled.workflow}
                </pre>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
