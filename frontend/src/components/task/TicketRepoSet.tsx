import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { reposApi, type ProjectRepository, type TaskRepoBinding } from '@/lib/builderforceApi';
import { RoleGate } from '@/components/RoleGate';

/**
 * The ticket's REPO SET (migration 0956).
 *
 * No `'use client'` of its own: `RunAgentControl` is its only importer and is
 * already a client boundary, so a directive here would mark nothing and would
 * cost a point on the frontend-architecture ratchet for no interactivity gained.
 *
 * A run has always targeted exactly one repo: one branch, one PR. A ticket that
 * legitimately crosses repositories — "add the endpoint in `api`, call it from
 * `frontend`" — binds more than one here. Each bound repo gets its own working
 * branch, each file the agent writes is routed to the repo whose `pathGlobs`
 * claim its path, and finalize opens a PR per repo that actually received code.
 *
 * Deliberately additive: binding nothing leaves the ticket exactly as it was —
 * the run resolves its single repo the way it always did. That is why this shows
 * the resolved DEFAULT as a pinned row rather than pretending the set is empty.
 *
 * Renders nothing when the project has fewer than two repos: there is no set to
 * choose from, and an empty control on every ticket would be noise.
 */
export function TicketRepoSet({ taskId, projectId }: { taskId: number; projectId: number }) {
  const t = useTranslations('ticketRepoSet');
  const [repos, setRepos] = useState<ProjectRepository[]>([]);
  const [bindings, setBindings] = useState<TaskRepoBinding[]>([]);
  const [primaryRepoId, setPrimaryRepoId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    Promise.all([
      reposApi.list(projectId).catch(() => [] as ProjectRepository[]),
      reposApi.getTaskRepoBindings(taskId).catch(() => ({ primaryRepoId: null, bindings: [] })),
    ]).then(([list, set]) => {
      if (cancelled) return;
      setRepos(list);
      setBindings(set.bindings);
      setPrimaryRepoId(set.primaryRepoId);
    });
    return () => { cancelled = true; };
  }, [taskId, projectId]);

  useEffect(() => load(), [load]);

  const bound = new Set(bindings.map((b) => b.repoId));

  const toggle = async (repoId: string) => {
    const next = new Set(bound);
    if (next.has(repoId)) next.delete(repoId);
    else next.add(repoId);
    setSaving(true);
    setError(null);
    try {
      const updated = await reposApi.setTaskRepoBindings(taskId, [...next]);
      setBindings(updated.bindings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Nothing to span across.
  if (repos.length < 2) return null;

  const spanning = bindings.filter((b) => b.repoId !== primaryRepoId).length > 0;

  return (
    <div
      style={{
        marginTop: 10,
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-deep)',
        padding: '10px 12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span className="ui-text-field-label">{t('title')}</span>
        <span className="ui-text-small" style={{ color: 'var(--text-muted)' }}>
          {spanning ? t('spanningHint') : t('singleHint')}
        </span>
      </div>

      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {repos.map((r) => {
          const b = bindings.find((x) => x.repoId === r.id);
          const isPrimary = r.id === primaryRepoId;
          return (
            <li
              key={r.id}
              className="ui-text-small"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                color: 'var(--text-secondary)', minWidth: 0,
              }}
            >
              <RoleGate capability="runtime.execute" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  id={`ticket-repo-${taskId}-${r.id}`}
                  checked={bound.has(r.id)}
                  disabled={saving}
                  onChange={() => void toggle(r.id)}
                  style={{ accentColor: 'var(--coral-bright)', cursor: saving ? 'default' : 'pointer' }}
                />
              </RoleGate>
              <label
                htmlFor={`ticket-repo-${taskId}-${r.id}`}
                style={{ color: 'var(--text-primary)', fontWeight: 600, overflowWrap: 'anywhere', cursor: saving ? 'default' : 'pointer' }}
              >
                {r.owner}/{r.repo}
              </label>
              {isPrimary && (
                <span className="ui-text-field-label" style={{ color: 'var(--coral-bright)' }}>
                  {t('primary')}
                </span>
              )}
              {b && b.writesCount > 0 && (
                <span style={{ color: 'var(--text-muted)' }}>{t('writes', { count: b.writesCount })}</span>
              )}
              {b?.prUrl && (
                <a href={b.prUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>
                  {t('prLink', { number: b.prNumber ?? 0 })}
                </a>
              )}
              {b && b.writesCount === 0 && !b.prUrl && (
                <span style={{ color: 'var(--text-muted)' }}>{t('noWritesYet')}</span>
              )}
            </li>
          );
        })}
      </ul>

      {error && <div className="ui-text-small" style={{ color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </div>
  );
}
