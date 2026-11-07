/**
 * The editor half of packing a workspace folder (PRD 40): the review behind Create / Update
 * Knowledge Pack, and the pack a reviewed root's store holds. The pure halves —
 * `packFromStore`, `reviewHasWork` — live in `@builderforce/agent-tools/knowledge`; this only
 * supplies the root's ports (store, manifest, snapshot file), the progress notification and
 * the review's provenance (who reviewed, with which model, when).
 */

import * as vscode from "vscode";
import {
  packFromStore, reviewHasWork,
  type PackProvenance, type PortableKnowledgePack,
} from "@builderforce/agent-tools/knowledge";
import type { Extracted, LocalSnapshotStore } from "@seanhogg/builderforce-memory/knowledge";
import { getCurrentUserName } from "../../bfApi";
import type { KnowledgeRoot } from "../knowledgeRoots";
import { log, openRoot, reviewRoot, type OpenRoot } from "../knowledgeService";

/**
 * The extract cache of a root, keyed by content hash — read THROUGH the root's one local store (its log, else a
 * legacy snapshot's `extracted`), never from the snapshot file: the snapshot no longer holds it.
 */
async function extractedOf(open: OpenRoot, rootId: string): Promise<Record<string, Extracted[]>> {
  try {
    const local = open.local as unknown as Partial<Pick<LocalSnapshotStore, "extractedEntries">>;
    return (await local.extractedEntries?.()) ?? {};
  } catch (error) {
    log(`pack extracted ${rootId}`, error);
    return {};
  }
}

/** A reviewed root's pack: its own scope, facts, relations, extracted cache and retrieval cards, with the review's provenance when known. */
export async function packOfRoot(
  context: vscode.ExtensionContext,
  root: KnowledgeRoot,
  name: string,
  provenance?: PackProvenance,
): Promise<PortableKnowledgePack> {
  const open = openRoot(context.secrets, root);
  return packFromStore({
    name,
    rootId: root.rootId,
    title: root.title,
    store: open.store,
    manifest: open.manifest,
    extracted: await extractedOf(open, root.rootId),
    ...(provenance ? { provenance } : {}),
    onError: (error) => log(`pack cards ${root.rootId}`, error),
  });
}

export interface PackReviewOptions {
  /** Skip the review when the folder's last review is current (nothing changed, nothing owed) and its scope is in the store. */
  skipIfFresh?: boolean;
}

/**
 * What a review that just ran says about itself: who ran it (signed in; omitted when signed
 * out), the model that actually judged (omitted when no judgement ran), when. The runner
 * exposes no review-policy name, so none is recorded.
 */
async function provenanceOfReview(context: vscode.ExtensionContext, judgeModel: string | undefined): Promise<PackProvenance> {
  const reviewedBy = await getCurrentUserName(context.secrets).catch(() => null);
  return {
    ...(reviewedBy ? { reviewedBy } : {}),
    ...(judgeModel ? { judgeModel } : {}),
    reviewedAt: new Date().toISOString(),
  };
}

/**
 * A `withProgress` review of `root` (plan, then run on that plan). `skipped` when the plan had
 * no work to do — no review ran, so the provenance is only the time the root was last reviewed
 * (never this person or this machine's model). Otherwise `provenance` describes the review just run.
 */
export async function reviewForPack(
  context: vscode.ExtensionContext,
  root: KnowledgeRoot,
  title: string,
  opts: PackReviewOptions = {},
): Promise<{ skipped: boolean; provenance?: PackProvenance }> {
  const review = reviewRoot(context.secrets, root);
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    async (progress) => {
      progress.report({ message: vscode.l10n.t("Planning…") });
      const plan = await review.plan();
      if (opts.skipIfFresh && !reviewHasWork(plan)) {
        const scope = (await review.open.store.scopes()).find((s) => s.rootId === root.rootId);
        if (scope) return { skipped: true, ...(scope.lastReviewedAt ? { provenance: { reviewedAt: scope.lastReviewedAt } } : {}) };
      }
      await review.run({
        plan,
        onProgress: (p) => progress.report({ message: `${p.phase} ${p.done}/${p.total}` }),
      });
      return { skipped: false, provenance: await provenanceOfReview(context, await review.judgeModel()) };
    },
  );
}
