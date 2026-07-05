'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { runtimeApi, type TaskFileChange } from '@/lib/builderforceApi';
import { FileChangeViewer } from './FileChangeViewer';

/** The three kinds of file change an agent records (create / modify / delete). */
export type FileChangeKind = 'created' | 'modified' | 'deleted';

/** One file change to list — path + kind, with optional agent attribution. */
export interface ChangeItem {
  path: string;
  change: FileChangeKind;
  agent?: string;
}

export const CHANGE_COLOR: Record<FileChangeKind, string> = {
  created: 'var(--success, #16a34a)',
  modified: 'var(--coral-bright)',
  deleted: 'var(--danger, #dc2626)',
};

/**
 * One row in the Changes list. A button so it reads as clickable — selecting it
 * opens the file's diff in the Monaco viewer. Optional `agent` shows attribution
 * for the durable per-agent change rows.
 */
export function ChangeRow({
  path,
  change,
  agent,
  onOpen,
  openLabel,
}: {
  path: string;
  change: FileChangeKind;
  agent?: string;
  onOpen: () => void;
  openLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={openLabel}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '6px 4px', borderTop: '1px solid var(--border-subtle)', border: 'none',
        borderTopColor: 'var(--border-subtle)', background: 'none', cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: CHANGE_COLOR[change], width: 64, flexShrink: 0 }}>{change}</span>
      <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--coral-bright)', wordBreak: 'break-all' }}>{path}</span>
      {agent && <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }} title={agent}>{agent}</span>}
    </button>
  );
}

/**
 * The per-task file-change list + Monaco diff detail — the SINGLE source for
 * "show me what changed on this ticket". Used both as the Changes sub-tab inside
 * the agent execution panel (caller passes the execution-scoped `changes`) and as
 * the first-class Changes drawer tab on a task (omit `changes` → it fetches the
 * task's durable changes itself). Owns its open-file state; FileChangeViewer owns
 * its own scroll, so the list is capped but an open diff renders at full height.
 */
export function TaskChangesPanel({
  taskId,
  changes,
  emptyLabel,
  resetKey,
  maxHeight = 360,
}: {
  taskId: number;
  /** Pre-supplied change list (execution-scoped). Omit to self-fetch the task's changes. */
  changes?: ChangeItem[];
  /** Message when there are no changes. Defaults to a localized string. */
  emptyLabel?: string;
  /** When this value changes, the open-file detail resets back to the list. */
  resetKey?: string | number;
  maxHeight?: number;
}) {
  const t = useTranslations('taskChanges');
  const selfFetch = changes === undefined;
  const [fetched, setFetched] = useState<TaskFileChange[] | null>(null);
  const [openChange, setOpenChange] = useState<{ path: string; change: FileChangeKind } | null>(null);

  useEffect(() => {
    if (!selfFetch) return;
    let cancelled = false;
    setFetched(null);
    runtimeApi
      .taskFileChanges(taskId)
      .then((r) => { if (!cancelled) setFetched(r.changes); })
      .catch(() => { if (!cancelled) setFetched([]); });
    return () => { cancelled = true; };
  }, [selfFetch, taskId]);

  // Return to the list whenever the scope changes (execution switch / task switch).
  useEffect(() => { setOpenChange(null); }, [resetKey, taskId]);

  const list: ChangeItem[] = changes ?? (fetched ?? []).map((f) => ({ path: f.path, change: f.change, agent: f.agent }));
  const loading = selfFetch && fetched === null;

  return (
    <div style={openChange ? { minHeight: 80 } : { minHeight: 80, maxHeight, overflow: 'auto' }}>
      {openChange ? (
        <div>
          <button
            type="button"
            onClick={() => setOpenChange(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '4px 8px', fontSize: 12, border: 'none', background: 'none', color: 'var(--coral-bright)', cursor: 'pointer' }}
          >
            ‹ {t('allChanges')}
          </button>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all', marginBottom: 8 }}>
            <span style={{ fontWeight: 700, textTransform: 'uppercase', color: CHANGE_COLOR[openChange.change], marginRight: 8 }}>{openChange.change}</span>
            {openChange.path}
          </div>
          <FileChangeViewer taskId={taskId} path={openChange.path} />
        </div>
      ) : loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>{t('loading')}</div>
      ) : list.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>{emptyLabel ?? t('empty')}</div>
      ) : (
        list.map((f, i) => (
          <ChangeRow
            key={`${f.path}-${i}`}
            path={f.path}
            change={f.change}
            agent={f.agent}
            openLabel={t('viewInEditor')}
            onOpen={() => setOpenChange({ path: f.path, change: f.change })}
          />
        ))
      )}
    </div>
  );
}
