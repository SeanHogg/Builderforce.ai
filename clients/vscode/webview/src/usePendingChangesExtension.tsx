import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PENDING_CHANGES_LABELS,
  PendingChangesList,
  bundleLookup,
  pendingChangesSummary,
  stringsFrom,
  type ChatTicketsExtension,
  type PendingChangeVM,
  type PendingChangesLabels,
} from '@seanhogg/builderforce-brain-ui';
import { getPendingChanges, onPendingChanges, post, type LabelBundle, type PendingChangeSet } from './vscodeBridge';
import { scopeChangesToChat } from './chatChangeScope';

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
export function usePendingChangesExtension(labels: LabelBundle, chatFiles: readonly string[] | null): ChatTicketsExtension | null {
  const [set, setSet] = useState<PendingChangeSet | undefined>(getPendingChanges);
  useEffect(() => onPendingChanges(setSet), []);

  // Flatten repo groups to rows. The row DISPLAYS the repo-relative path, which two
  // repositories can share, so the ABSOLUTE path — the thing the host needs back to
  // open a diff — rides along as the row's opaque `id`. Then keep only this chat's
  // files when the chat has recorded any (`scopeChangesToChat`).
  const changes = useMemo<PendingChangeVM[]>(
    () =>
      scopeChangesToChat(
        (set?.repos ?? []).flatMap((repo) =>
          repo.changes.map((change) => ({
            id: change.path,
            path: change.relativePath,
            status: change.status,
            staged: change.staged,
            repo: repo.name,
          })),
        ),
        chatFiles,
      ),
    [set, chatFiles],
  );

  const listLabels = useMemo<PendingChangesLabels>(() => {
    // The bundle's `changes.<field>` / `changes.status.<kind>` over brain-ui's English.
    const lookup = bundleLookup(labels, (key) => `changes.${key}`);
    return {
      ...stringsFrom(DEFAULT_PENDING_CHANGES_LABELS, lookup),
      status: stringsFrom(DEFAULT_PENDING_CHANGES_LABELS.status, lookup, 'status.'),
    };
  }, [labels]);

  return useMemo<ChatTicketsExtension | null>(() => {
    if (!changes.length) return null;
    return {
      key: 'pending-changes',
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" />
          <path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5" />
        </svg>
      ),
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
