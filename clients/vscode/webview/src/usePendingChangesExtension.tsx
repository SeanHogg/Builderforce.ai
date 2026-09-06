import { useEffect, useMemo, useState } from 'react';
import {
  PendingChangesList,
  pendingChangesSummary,
  resolvePendingChangesLabels,
  type ChatTicketsExtension,
  type PendingChangeVM,
  type PendingChangesLabels,
} from '@seanhogg/builderforce-brain-ui';
import { getPendingChanges, onPendingChanges, post, type LabelBundle, type PendingChangeSet } from './vscodeBridge';

/**
 * The VS Code host's "Changes (N)" pill for the chat's ticket rail — the chat's own
 * "this turn left code on disk" signal, sitting beside Link ticket · Agents · People.
 *
 * A Brain turn edits the workspace through the host's local tools. Before this, the
 * transcript was the ONLY place that fact appeared: the chat, the ticket rail and every
 * sidebar section rendered a finished turn while unreviewed edits sat in the working
 * tree, and the only way to them was noticing VS Code's separate Source Control view.
 * The first fix was a separate block ABOVE the rail, which pushed the rail itself
 * under the header; the count now rides in the rail's own pill row as a
 * {@link ChatTicketsExtension}, and the file list is the drawer that pill opens.
 *
 * Everything host-specific lives here — subscribing to the host's live change set,
 * flattening it to the presentational shape, and routing "open" / "review" back over
 * the bridge to the SAME commands the Changes sidebar uses. Returns `null` on a clean
 * tree, so the rail shows no pill at all rather than "Changes (0)".
 */
export function usePendingChangesExtension(labels: LabelBundle): ChatTicketsExtension | null {
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

  const listLabels = useMemo<PendingChangesLabels>(() => {
    const t = (key: string, fallback: string) => labels[key] ?? fallback;
    return resolvePendingChangesLabels({
      pill: t('changes.pill', 'Changes'),
      summary: t('changes.summary', '{count} uncommitted changes'),
      summaryOne: t('changes.summaryOne', '1 uncommitted change'),
      hint: t('changes.hint', 'Changed in your workspace and not committed yet.'),
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
    });
  }, [labels]);

  return useMemo<ChatTicketsExtension | null>(() => {
    if (!changes.length) return null;
    return {
      key: 'pending-changes',
      icon: '⎇',
      label: listLabels.pill,
      count: changes.length,
      title: pendingChangesSummary(changes.length, listLabels),
      render: () => (
        <PendingChangesList
          changes={changes}
          labels={listLabels}
          onOpenChange={(change) => {
            if (change.id) post('changes.open', { changePath: change.id, changeStatus: change.status });
          }}
          onReview={() => post('changes.review')}
        />
      ),
    };
  }, [changes, listLabels]);
}
