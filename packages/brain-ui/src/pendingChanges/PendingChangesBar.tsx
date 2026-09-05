import React, { useState } from 'react';

/**
 * The chat's "this turn left code on disk" bar.
 *
 * A Brain turn can edit the workspace through its local tools, and until this bar the
 * conversation was the ONLY record that it had: the transcript said "the file change
 * has been made", the ticket rail showed a task in progress, and nothing anywhere told
 * you there were now unreviewed edits in the working tree — let alone gave you a way
 * to look at them. You had to notice the editor's separate Source Control view on your
 * own, and correlate it to the chat by memory.
 *
 * So this sits directly under the ticket rail, states the count, and opens each file's
 * real diff. It renders the working set as the HOST reports it — the host owns what
 * "pending" means (its git working tree) and what "open" does (the editor's own diff
 * viewer); this component owns only how it reads.
 *
 * Self-gating, per the shared-component rule: nothing pending ⇒ it renders nothing, so
 * a host mounts it unconditionally and never computes a `shouldShow` of its own. A
 * surface with no local working tree (the web app) simply passes no changes and the
 * bar stays invisible without a second code path.
 */

/** What happened to one file. Mirrors the host's git vocabulary. */
export type PendingChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflict'
  | 'typechange';

/** One uncommitted file, as a surface renders it. */
export interface PendingChangeVM {
  /**
   * Stable, host-defined identity for this row — the React key, and what the host
   * recognises the row by when `onOpenChange` hands it back. Opaque here on purpose:
   * the displayed path is repo-relative and two repositories can hold the same one,
   * so it is not an identity. Defaults to the path when a host has nothing better.
   */
  id?: string;
  /** Repo-relative path — what the user reads. Display only; see {@link id}. */
  path: string;
  status: PendingChangeKind;
  /** Already staged in the index. Shown, because it changes what "commit" will do. */
  staged: boolean;
  /** Repository name; shown only when more than one repository has pending work. */
  repo?: string;
}

export interface PendingChangesLabels {
  /** Summary heading. Must contain the literal `{count}` token. */
  summary: string;
  /** Summary heading for exactly one change. */
  summaryOne: string;
  /** Explains WHY the bar is there, under the heading. */
  hint: string;
  expand: string;
  collapse: string;
  review: string;
  staged: string;
  /** Per-status words, shown beside each path. */
  status: Record<PendingChangeKind, string>;
}

export const DEFAULT_PENDING_CHANGES_LABELS: PendingChangesLabels = {
  summary: '{count} uncommitted changes',
  summaryOne: '1 uncommitted change',
  hint: 'Changed in your workspace and not committed yet.',
  expand: 'Show the changed files',
  collapse: 'Hide the changed files',
  review: 'Review',
  staged: 'staged',
  status: {
    modified: 'modified',
    added: 'added',
    deleted: 'deleted',
    renamed: 'renamed',
    untracked: 'new',
    conflict: 'conflict',
    typechange: 'type changed',
  },
};

export interface PendingChangesBarProps {
  /** The uncommitted files. Empty ⇒ the bar renders nothing. */
  changes: PendingChangeVM[];
  /** Open one file's diff. */
  onOpenChange: (change: PendingChangeVM) => void;
  /**
   * Take the user to the full review surface (the editor's Changes / Source Control
   * view). Omit on a surface that has none — the button then isn't offered.
   */
  onReview?: () => void;
  /** Start expanded. Defaults to collapsed: the COUNT is the signal, the list is on demand. */
  defaultExpanded?: boolean;
  labels?: Partial<PendingChangesLabels>;
  className?: string;
  style?: React.CSSProperties;
}

/** Status → the colour that reads correctly in both a light and a dark host. */
function statusColor(status: PendingChangeKind): string {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'var(--bf-success, #2e9e5b)';
    case 'deleted':
      return 'var(--bf-danger, var(--bf-error, #d64545))';
    case 'conflict':
      return 'var(--bf-warning, #c98a1b)';
    default:
      return 'var(--bf-accent, #4a8cf7)';
  }
}

/** Split a repo-relative path into its directory and file name for two-tone display. */
function splitPath(path: string): { dir: string; file: string } {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? { dir: '', file: path } : { dir: path.slice(0, cut + 1), file: path.slice(cut + 1) };
}

export function PendingChangesBar({
  changes,
  onOpenChange,
  onReview,
  defaultExpanded = false,
  labels: labelOverrides,
  className,
  style,
}: PendingChangesBarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const labels = {
    ...DEFAULT_PENDING_CHANGES_LABELS,
    ...labelOverrides,
    status: { ...DEFAULT_PENDING_CHANGES_LABELS.status, ...labelOverrides?.status },
  };

  // Nothing pending is not a state worth a row — the bar simply isn't there.
  if (!changes.length) return null;

  const heading =
    changes.length === 1 ? labels.summaryOne : labels.summary.replace('{count}', String(changes.length));
  // The repository only earns space when it disambiguates.
  const showRepo = new Set(changes.map((c) => c.repo ?? '')).size > 1;

  return (
    <section
      className={className}
      aria-label={heading}
      style={{
        border: '1px solid var(--bf-border, rgba(128, 128, 128, 0.35))',
        borderRadius: 8,
        background: 'var(--bf-surface-2, var(--bf-surface, transparent))',
        fontSize: 12,
        color: 'var(--bf-text, inherit)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 8px' }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? labels.collapse : labels.expand}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flex: '1 1 auto',
            minWidth: 0,
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden style={{ flex: '0 0 auto', opacity: 0.7 }}>{expanded ? '▾' : '▸'}</span>
          <span
            aria-hidden
            style={{
              flex: '0 0 auto',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--bf-accent, #4a8cf7)',
            }}
          />
          <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{heading}</span>
        </button>
        {onReview && (
          <button
            type="button"
            onClick={onReview}
            style={{
              flex: '0 0 auto',
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 700,
              color: 'inherit',
              background: 'transparent',
              border: '1px solid currentColor',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {labels.review}
          </button>
        )}
      </div>

      <div style={{ padding: '0 8px 6px 30px', color: 'var(--bf-text-muted, #8a8a8a)' }}>{labels.hint}</div>

      {expanded && (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 4px 6px' }}>
          {changes.map((change) => {
            const { dir, file } = splitPath(change.path);
            const state = change.staged
              ? `${labels.status[change.status]} · ${labels.staged}`
              : labels.status[change.status];
            return (
              <li key={change.id ?? `${change.repo ?? ''}:${change.path}`}>
                <button
                  type="button"
                  onClick={() => onOpenChange(change)}
                  title={`${change.path} — ${state}`}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    width: '100%',
                    padding: '3px 6px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 4,
                    color: 'inherit',
                    font: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    aria-hidden
                    style={{ flex: '0 0 auto', width: 6, height: 6, borderRadius: '50%', background: statusColor(change.status) }}
                  />
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontFamily: 'var(--bf-font-mono, monospace)' }}>
                    {dir && <span style={{ opacity: 0.6 }}>{dir}</span>}
                    <span>{file}</span>
                  </span>
                  <span style={{ flex: '1 1 auto' }} />
                  {showRepo && change.repo && (
                    <span style={{ flex: '0 0 auto', color: 'var(--bf-text-muted, #8a8a8a)' }}>{change.repo}</span>
                  )}
                  <span style={{ flex: '0 0 auto', color: 'var(--bf-text-muted, #8a8a8a)' }}>{state}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
