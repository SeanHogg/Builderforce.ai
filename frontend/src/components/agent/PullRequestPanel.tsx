'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  reposApi,
  type MergeMethod,
  type TaskPullRequest,
  type PullRequestDetail,
} from '@/lib/builderforceApi';

/**
 * In-product Pull Request review for a task's run. Shows the recorded PR + its
 * LIVE provider state (status, mergeability, CI checks, diff stat) and an
 * "Approve & Merge" button so a human lands the change without leaving the product
 * (replacing the old bare "View pull request →" external link).
 *
 * Owns its own visibility: renders `null` when the task has no PR yet, so the
 * caller can mount it unconditionally without prop-drilling a "hasPr" flag.
 */

const STATUS_COLOR: Record<string, string> = {
  open: 'var(--coral-bright)',
  merged: 'var(--success, #16a34a)',
  closed: 'var(--text-muted)',
  draft: 'var(--text-muted)',
};

const CHECK_COLOR: Record<string, string> = {
  success: 'var(--success, #16a34a)',
  failure: 'var(--danger, #dc2626)',
  pending: 'var(--warning, #d97706)',
};

const MERGE_METHODS: MergeMethod[] = ['squash', 'merge', 'rebase'];

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
      color, border: `1px solid ${color}`, borderRadius: 6, padding: '2px 6px',
    }}>{label}</span>
  );
}

/**
 * The persisted build outcome (status + REASON) for a PR, recorded from CI by the
 * webhook. Used for BOTH the pre-merge PR-branch build (so the agent's failing build
 * — and why — is visible on the ticket before merge) and the post-merge deploy build.
 * Renders null when there's nothing to show, so callers mount it unconditionally.
 */
function BuildStatus({ status, error, phase, showValidating }: {
  status: string | null;
  error: string | null;
  phase: 'pre-merge' | 'post-merge';
  showValidating: boolean;
}) {
  const validating = status === 'pending' || (showValidating && status == null);
  if (!status && !validating) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-muted)' }}>{phase === 'pre-merge' ? 'PR build:' : 'Build:'}</span>
        {status === 'success' && <Badge label="passing" color={CHECK_COLOR.success} />}
        {status === 'failure' && <Badge label="failing" color={CHECK_COLOR.failure} />}
        {validating && <span style={{ color: 'var(--text-muted)' }}>⏳ validating…</span>}
        {status === 'failure' && (
          <span style={{ color: 'var(--warning, #d97706)' }}>
            {phase === 'pre-merge'
              ? 'auto-fix dispatched — the agent will push a fix to this branch.'
              : 'auto-fix dispatched — a new PR will open for review.'}
          </span>
        )}
      </div>
      {status === 'failure' && error && (
        <pre style={{
          margin: 0, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--text-secondary)', background: 'var(--bg-subtle, rgba(127,127,127,0.08))',
          border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '8px 10px',
          maxHeight: 220, overflow: 'auto', fontFamily: 'var(--font-mono)',
        }}>{error}</pre>
      )}
    </div>
  );
}

export function PullRequestPanel({ taskId, onMerged }: { taskId: number; onMerged?: () => void }) {
  const [data, setData] = useState<TaskPullRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    reposApi.getTaskPullRequest(taskId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => load(), [load]);

  // The build runs async (validated via webhook) both pre-merge (on the PR branch) and
  // post-merge (on the deploy branch). Poll quietly (bounded) while the build is still
  // pending so the badge + reason + auto-fix status update without a manual refresh.
  const pr0 = data?.pullRequest;
  const buildPending = pr0?.buildStatus === 'pending'
    || (pr0?.status === 'merged' && (pr0.buildStatus == null || pr0.buildStatus === 'pending'));
  useEffect(() => {
    if (!buildPending) return;
    let n = 0;
    const t = setInterval(() => {
      if (++n > 10) { clearInterval(t); return; }  // ~3.5 min ceiling
      reposApi.getTaskPullRequest(taskId).then((d) => { if (d) setData(d); }).catch(() => {});
    }, 20_000);
    return () => clearInterval(t);
  }, [buildPending, taskId]);

  const merge = async () => {
    if (!data?.pullRequest) return;
    setMerging(true);
    setError(null);
    try {
      await reposApi.mergePullRequest(data.pullRequest.id, method);
      load();
      onMerged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>Loading pull request…</div>;
  if (!data?.pullRequest) return null;

  const pr = data.pullRequest;
  const detail: PullRequestDetail | null = data.detail;
  const isMerged = pr.status === 'merged' || detail?.merged === true;
  const checks = detail?.checks ?? null;
  const checksRed = checks === 'failure' || checks === 'pending';

  return (
    <div style={{ minHeight: 80, fontSize: 13, color: 'var(--text-secondary)' }}>
      {/* Header: number + status + branch flow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {pr.number != null ? `PR #${pr.number}` : 'Pull request'}
        </span>
        <Badge label={isMerged ? 'merged' : pr.status} color={STATUS_COLOR[isMerged ? 'merged' : pr.status] ?? 'var(--text-muted)'} />
        {pr.branchName && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
            {pr.branchName} → {pr.baseBranch ?? 'main'}
          </span>
        )}
      </div>

      {/* Live detail: mergeability, checks, diff stat */}
      {detail?.supported && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          {checks && <span style={{ color: CHECK_COLOR[checks] }}>● CI {checks}{detail.checksTotal ? ` (${detail.checksTotal})` : ''}</span>}
          {detail.mergeable === false && !isMerged && <span style={{ color: 'var(--danger, #dc2626)' }}>not mergeable{detail.mergeableState ? ` · ${detail.mergeableState}` : ''}</span>}
          {(detail.changedFiles != null) && (
            <span style={{ color: 'var(--text-muted)' }}>
              {detail.changedFiles} file{detail.changedFiles === 1 ? '' : 's'}
              {detail.additions != null && <span style={{ color: 'var(--success, #16a34a)' }}> +{detail.additions}</span>}
              {detail.deletions != null && <span style={{ color: 'var(--danger, #dc2626)' }}> −{detail.deletions}</span>}
            </span>
          )}
        </div>
      )}
      {detail && !detail.supported && detail.error && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Live status unavailable ({detail.error}).</div>
      )}

      {/* Pre-merge PR-branch build outcome + REASON (recorded from CI) — so a red build
          on the agent's branch, and WHY, is visible on the ticket before it's merged. */}
      {!isMerged && (
        <div style={{ marginBottom: 10 }}>
          <BuildStatus status={pr.buildStatus} error={pr.buildError} phase="pre-merge" showValidating={false} />
        </div>
      )}

      {/* Approve & merge — enabled anytime (warns on red checks per product policy) */}
      {!isMerged && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as MergeMethod)}
            disabled={merging}
            style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
          >
            {MERGE_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button
            type="button"
            onClick={merge}
            disabled={merging}
            style={{
              fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 6, border: 'none', cursor: merging ? 'default' : 'pointer',
              background: 'var(--success, #16a34a)', color: 'var(--text-on-accent, #fff)', opacity: merging ? 0.6 : 1,
            }}
          >
            {merging ? 'Merging…' : 'Approve & Merge'}
          </button>
          {checksRed && <span style={{ fontSize: 12, color: 'var(--warning, #d97706)' }}>⚠ CI is {checks} — merging anyway will override it.</span>}
        </div>
      )}

      {isMerged && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--success, #16a34a)' }}>
            ✓ Merged{pr.mergedAt ? ` ${new Date(pr.mergedAt).toLocaleString()}` : ''}.
          </div>
          {/* Post-merge deploy-branch build validation (status + reason + auto-fix). */}
          <BuildStatus status={pr.buildStatus} error={pr.buildError} phase="post-merge" showValidating />
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 8 }}>{error}</div>}

      {pr.url && (
        <a href={pr.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Open on {pr.provider === 'github' ? 'GitHub' : pr.provider} ↗
        </a>
      )}
    </div>
  );
}
