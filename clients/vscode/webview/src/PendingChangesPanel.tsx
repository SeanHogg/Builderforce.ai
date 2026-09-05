import { useEffect, useMemo, useState } from 'react';
import {
  PendingChangesBar,
  type PendingChangeVM,
  type PendingChangesLabels,
} from '@seanhogg/builderforce-brain-ui';
import { getPendingChanges, onPendingChanges, post, type LabelBundle, type PendingChangeSet } from './vscodeBridge';

/**
 * The VS Code host's wrapper around the shared `PendingChangesBar` — the chat's own
 * "this turn left code on disk" signal, sitting under the ticket rail.
 *
 * A Brain turn edits the workspace through the host's local tools. Before this, the
 * transcript was the ONLY place that fact appeared: the chat, the ticket rail and every
 * sidebar section rendered a finished turn while unreviewed edits sat in the working
 * tree, and the only way to them was noticing VS Code's separate Source Control view.
 *
 * Everything host-specific lives here — subscribing to the host's live change set,
 * flattening it to the presentational shape, and routing "open" / "review" back over
 * the bridge to the SAME commands the Changes sidebar uses. The bar itself is shared
 * and self-gating, so this component renders nothing at all on a clean tree.
 */
export function PendingChangesPanel({ labels }: { labels: LabelBundle }) {
  const [set, setSet] = useState<PendingChangeSet | undefined>(getPendingChanges);
  useEffect(() => onPendingChanges(setSet), []);

  // Flatten repo groups to rows. The row DISPLAYS the repo-relative path, which two
  // repositories can share, so the ABSOLUTE path — the thing the host needs back to
  // open a diff — rides along as the row's opaque `id`.
  const changes = useMemo<PendingChangeVM[]>(
    () =>
      (set?.repos ?? []).flatMap((repo) =>
        repo.changes.map((change) => ({
          id: change.path,
          path: change.relativePath,
          status: change.status,
          staged: change.staged,
          repo: repo.name,
        })),
      ),
    [set],
  );

  const barLabels = useMemo<Partial<PendingChangesLabels>>(() => {
    const t = (key: string, fallback: string) => labels[key] ?? fallback;
    return {
      summary: t('changes.summary', '{count} uncommitted changes'),
      summaryOne: t('changes.summaryOne', '1 uncommitted change'),
      hint: t('changes.hint', 'Changed in your workspace and not committed yet.'),
      expand: t('changes.expand', 'Show the changed files'),
      collapse: t('changes.collapse', 'Hide the changed files'),
      review: t('changes.review', 'Review'),
      staged: t('changes.staged', 'staged'),
      status: {
        modified: t('changes.status.modified', 'modified'),
        added: t('changes.status.added', 'added'),
        deleted: t('changes.status.deleted', 'deleted'),
        renamed: t('changes.status.renamed', 'renamed'),
        untracked: t('changes.status.untracked', 'new'),
        conflict: t('changes.status.conflict', 'conflict'),
        typechange: t('changes.status.typechange', 'type changed'),
      },
    };
  }, [labels]);

  return (
    <PendingChangesBar
      changes={changes}
      labels={barLabels}
      // Matches the ticket rail's gutter; owned here rather than by a wrapper in App,
      // so a clean tree renders nothing at all instead of an empty spacer div.
      style={{ margin: '0 12px 6px' }}
      onOpenChange={(change) => {
        if (change.id) post('changes.open', { changePath: change.id, changeStatus: change.status });
      }}
      onReview={() => post('changes.review')}
    />
  );
}
