'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import { RoleGate } from '@/components/RoleGate';
import {
  tasksApi,
  type CleanupApplyResult,
  type CleanupCandidate,
  type CleanupGroup,
  type CleanupSelection,
} from '@/lib/builderforceApi';

/**
 * The decomposition-cleanup REVIEW.
 *
 * The old heuristic decomposer shredded markdown into tickets: `**API Endpoints**:`
 * with no content, one-word category rows, and duplicate pairs from re-running the
 * decompose route. The parser guard stops NEW ones; these are the rows already on
 * the board and already on the planning spine.
 *
 * This is deliberately a REVIEW, not a purge button. Every row shows WHY it was
 * flagged and the evidence that nothing real is attached (runs / PRs / comments,
 * all zero), the reviewer ticks what they agree with, and only those ids are sent.
 * There is no "select everything in the workspace" affordance — select-all is
 * scoped to one Epic, which is the largest set a person can actually have looked at.
 *
 * Non-destructive detail lives in a SlideOutPanel per the repo convention; the
 * final confirm is the ONE modal, through `useConfirm` (never `window.confirm`).
 */
export function DecompositionCleanupPanel({
  projectId,
  open,
  onClose,
  onApplied,
}: {
  projectId?: number | null;
  open: boolean;
  onClose: () => void;
  /** Fired after a successful apply so the caller can refresh its own counts. */
  onApplied?: () => void;
}) {
  const t = useTranslations('cleanup');
  const tPlanning = useTranslations('planning');
  const confirm = useConfirm();

  const [groups, setGroups] = useState<CleanupGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<CleanupApplyResult | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await tasksApi.decompositionCleanup(projectId ?? null);
      setGroups(data.groups);
      // A reload invalidates any tick the reviewer had made against the OLD list —
      // silently carrying selections across a refresh would let them archive a row
      // they never saw the current state of.
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    if (open) { setResult(null); void load(); }
  }, [open, load]);

  const allCandidates = useMemo(
    () => (groups ?? []).flatMap((g) => g.candidates),
    [groups],
  );
  const byId = useMemo(
    () => new Map(allCandidates.map((c) => [c.taskId, c])),
    [allCandidates],
  );

  const toggle = (taskId: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });

  const toggleGroup = (group: CleanupGroup, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const c of group.candidates) { if (on) next.add(c.taskId); else next.delete(c.taskId); }
      return next;
    });

  const apply = async () => {
    if (selected.size === 0) return;
    // Archiving is destructive, so it is the one place a MODAL is right.
    const ok = await confirm({ message: t('confirm', { count: selected.size }), destructive: true });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const selections: CleanupSelection[] = [...selected].map((taskId) => {
        const candidate = byId.get(taskId);
        // A duplicate is MERGED into the sibling that is kept; anything else is
        // simply archived. The server re-verifies both, so this is a request, not
        // an instruction.
        return candidate?.reason === 'duplicate-sibling' && candidate.duplicateOfTaskId != null
          ? { taskId, action: 'merge', mergeIntoTaskId: candidate.duplicateOfTaskId }
          : { taskId, action: 'archive' };
      });
      setResult(await tasksApi.applyDecompositionCleanup(selections, projectId ?? null));
      await load();
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reasonLabel = (reason: CleanupCandidate['reason']) =>
    reason === 'not-a-work-item' ? t('reason.notAWorkItem') : t('reason.duplicateSibling');

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('title')} width="wide">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          {t('intro')}
        </p>

        {error && (
          <div role="alert" style={panel('danger')}>{error}</div>
        )}

        {result && (
          <div role="status" style={panel('success')}>
            {t('applied', { archived: result.archived.length, merged: result.merged.length })}
            {result.rejected.length > 0 && (
              <div style={{ marginTop: 6, color: 'var(--warning-text, var(--warning))' }}>
                <Icon source="⚠" size="1em" /> {t('rejected', { count: result.rejected.length })}
              </div>
            )}
          </div>
        )}

        {groups == null && !error && <div style={muted}>{t('loading')}</div>}
        {groups != null && groups.length === 0 && <div style={muted}>{t('empty')}</div>}

        {(groups ?? []).map((group) => {
          const groupIds = group.candidates.map((c) => c.taskId);
          const allOn = groupIds.every((id) => selected.has(id));
          return (
            <section key={group.epic.id} style={panel()}>
              <header style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
                <strong style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>
                  {group.epic.key ? `${group.epic.key} · ` : ''}{group.epic.title}
                </strong>
                {group.epic.decompositionSource && (
                  <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
                    {tPlanning(`source.${group.epic.decompositionSource}`)}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                  {t('flaggedCount', { count: group.candidates.length })}
                </span>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 'var(--font-size-small)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) => toggleGroup(group, e.target.checked)}
                    disabled={busy}
                  />
                  {t('selectAllInEpic')}
                </label>
              </header>

              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.candidates.map((c) => (
                  <li key={c.taskId}>
                    <label
                      style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px',
                        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                        background: selected.has(c.taskId) ? 'var(--bg-deep)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.taskId)}
                        onChange={() => toggle(c.taskId)}
                        disabled={busy}
                        style={{ marginTop: 3, flexShrink: 0 }}
                      />
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                          {c.taskKey ? <code style={{ color: 'var(--text-muted)', marginRight: 6 }}>{c.taskKey}</code> : null}
                          {c.title}
                        </span>
                        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 'var(--font-size-small)' }}>
                          <span style={{ color: 'var(--warning-text, var(--warning))', fontWeight: 600 }}>
                            {reasonLabel(c.reason)}
                          </span>
                          {/* The EVIDENCE, not just the verdict — the reviewer needs to
                              see that nothing real is attached before they agree. */}
                          <span style={{ color: 'var(--text-muted)' }}>
                            {t('evidence', {
                              runs: c.evidence.runs,
                              prs: c.evidence.pullRequests,
                              comments: c.evidence.comments,
                            })}
                          </span>
                          {c.duplicateOfTaskId != null && (
                            <span style={{ color: 'var(--text-muted)' }}>
                              {t('mergesInto', { id: c.duplicateOfTaskId })}
                            </span>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {allCandidates.length > 0 && (
          <RoleGate capability="manager.manage">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: 0, background: 'var(--bg-base)', paddingTop: 10 }}>
              <button
                type="button"
                onClick={apply}
                disabled={busy || selected.size === 0}
                style={{
                  padding: '9px 16px', borderRadius: 'var(--radius-md)', border: 'none',
                  background: selected.size === 0 ? 'var(--bg-elevated)' : 'var(--danger-text, var(--error-text))',
                  color: selected.size === 0 ? 'var(--text-muted)' : 'var(--text-on-accent)',
                  fontWeight: 700, fontSize: 'var(--font-size-small)',
                  cursor: selected.size === 0 ? 'default' : 'pointer',
                }}
              >
                {t('applySelected', { count: selected.size })}
              </button>
              <span style={muted}>{t('applyHint')}</span>
            </div>
          </RoleGate>
        )}
      </div>
    </SlideOutPanel>
  );
}

const muted: React.CSSProperties = { fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' };

function panel(tone?: 'danger' | 'success'): React.CSSProperties {
  return {
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    background: tone === 'danger' ? 'var(--danger-bg)' : tone === 'success' ? 'var(--success-bg)' : 'var(--bg-elevated)',
    color: tone === 'danger' ? 'var(--danger-text)' : tone === 'success' ? 'var(--success-text)' : 'var(--text-primary)',
    padding: 12,
    fontSize: 'var(--font-size-small)',
  };
}
