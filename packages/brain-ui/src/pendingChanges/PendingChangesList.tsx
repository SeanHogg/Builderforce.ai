import React from 'react';

/**
 * The chat's "this turn left code on disk" list.
 *
 * A Brain turn can edit the workspace through its local tools, and until this existed
 * the conversation was the ONLY record that it had: the transcript said "the file
 * change has been made", the ticket rail showed a task in progress, and nothing
 * anywhere told you there were now unreviewed edits in the working tree — let alone
 * gave you a way to look at them.
 *
 * The COUNT lives in the ticket rail's pill row (a `ChatTicketsExtension` the host
 * registers — see ChatTicketsPanel), so it sits beside Link ticket / Agents / People
 * instead of as a separate block above the rail that pushed the rail under the
 * header. This is the drawer that pill opens: the hint, each file's real diff, and
 * the review action. It renders the working set as the HOST reports it — the host
 * owns what "pending" means (its git working tree) and what "open" does (the editor's
 * own diff viewer); this component owns only how it reads.
 *
 * Self-gating, per the shared-component rule: nothing pending ⇒ it renders nothing.
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
  /** The pill's word in the ticket rail; the rail appends the count itself. */
  pill: string;
  /** Summary sentence (the pill's tooltip). Must contain the literal `{count}` token. */
  summary: string;
  /** Summary sentence for exactly one change. */
  summaryOne: string;
  /** Explains WHY the list is there, at the top of the drawer. */
  hint: string;
  review: string;
  staged: string;
  /** Per-status words, shown beside each path. */
  status: Record<PendingChangeKind, string>;
}

export const DEFAULT_PENDING_CHANGES_LABELS: PendingChangesLabels = {
  pill: 'Changes',
  summary: '{count} uncommitted changes',
  summaryOne: '1 uncommitted change',
  hint: 'Changed in your workspace and not committed yet.',
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

/** Merge a host's partial label bundle over the defaults (status words included). */
export function resolvePendingChangesLabels(overrides?: Partial<PendingChangesLabels>): PendingChangesLabels {
  return {
    ...DEFAULT_PENDING_CHANGES_LABELS,
    ...overrides,
    status: { ...DEFAULT_PENDING_CHANGES_LABELS.status, ...overrides?.status },
  };
}

/** "3 uncommitted changes" / "1 uncommitted change" — the ONE place the sentence is built. */
export function pendingChangesSummary(count: number, labels: PendingChangesLabels): string {
  return count === 1 ? labels.summaryOne : labels.summary.replace('{count}', String(count));
}

export interface PendingChangesListProps {
  /** The uncommitted files. Empty ⇒ the list renders nothing. */
  changes: PendingChangeVM[];
  /** Open one file's diff. */
  onOpenChange: (change: PendingChangeVM) => void;
  /**
   * Take the user to the full review surface (the editor's Changes / Source Control
   * view). Omit on a surface that has none — the button then isn't offered.
   */
  onReview?: () => void;
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

export function PendingChangesList({
  changes,
  onOpenChange,
  onReview,
  labels: labelOverrides,
  className,
  style,
}: PendingChangesListProps) {
  const labels = resolvePendingChangesLabels(labelOverrides);

  // Nothing pending is not a state worth a row — the list simply isn't there.
  if (!changes.length) return null;

  // The repository only earns space when it disambiguates.
  const showRepo = new Set(changes.map((c) => c.repo ?? '')).size > 1;

  return (
    <section
      className={className}
      aria-label={pendingChangesSummary(changes.length, labels)}
      style={{ fontSize: 12, color: 'var(--bf-text, inherit)', ...style }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '2px 0 6px' }}>
        <span style={{ flex: '1 1 auto', minWidth: 0, color: 'var(--bf-text-muted, #8a8a8a)' }}>{labels.hint}</span>
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

      {/* The rail sits ABOVE the scrolling transcript, so a large working tree (hundreds
          of files) must scroll inside the drawer rather than push the chat off-screen. */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 'min(40vh, 280px)', overflowY: 'auto' }}>
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
                  padding: '3px 4px',
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
    </section>
  );
}
