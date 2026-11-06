/**
 * A loaded knowledge pack as a READ-ONLY root in the knowledge panel (PRD 40): the one place
 * that decides which roots are packs, lists them beside the reviewed folders, loads their
 * graph from the pack file, and refuses every write aimed at one. The bridge
 * (`knowledgeBridge.ts`) only dispatches here, so it does not grow with pack rules.
 *
 * A pack whose root id IS an open workspace folder's (a pack made from this workspace) is
 * that folder, reviewable as ever — only a root nothing in the workspace holds is read-only.
 * "Held by the workspace" is the host index's one predicate (`ownsKnowledgeRoot`), the same
 * one that keeps a stale pack file from overwriting that folder's live index.
 */

import * as vscode from "vscode";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { packGraph, type PackGraphQuery } from "@builderforce/agent-tools/knowledge";
import type { KnowledgePackEntry } from "@builderforce/agent-tools/knowledge-index";
import { ownsKnowledgeRoot } from "../index/hostKnowledgeIndex";
import type { KnowledgeCall, KnowledgeScopeRow } from "../knowledgeProtocol";
import { loadedPackRegistry } from "./loadedPackRegistry";
import { readPackFile } from "./packIndexing";

/** The loaded pack standing as the read-only root `rootId`; undefined for anything else (a workspace folder included). */
export function readOnlyPack(rootId: string): KnowledgePackEntry | undefined {
  const entry = loadedPackRegistry().byRootId(rootId);
  return entry && !ownsKnowledgeRoot(rootId) ? entry : undefined;
}

/** One scope row per loaded pack that is a read-only root — from the registry's record, no pack file is read. */
export function packScopeRows(): KnowledgeScopeRow[] {
  const registry = loadedPackRegistry();
  return registry.all().flatMap((entry): KnowledgeScopeRow[] => {
    const record = registry.recordOf(entry.rootId);
    if (!record || !readOnlyPack(entry.rootId)) return [];
    const reviewed = record.lastReviewedAt ?? record.loadedAt;
    return [{
      rootId: entry.rootId,
      title: entry.title,
      packs: record.packs ?? [],
      ...(reviewed ? { lastReviewedAt: reviewed } : {}),
      readOnly: true,
      pack: entry.name,
    }];
  });
}

/** The graph of a read-only pack root, rebuilt from its (cached) file; null when the pack has no file path or holds nothing. */
export async function packRootGraph(entry: KnowledgePackEntry, query: PackGraphQuery): Promise<KnowledgeGraph | null> {
  if (!entry.path) return null;
  return packGraph(await readPackFile(entry.path), query);
}

/** The root a call would write to or review, when it names one. */
function targetRoot(call: KnowledgeCall, lastRoot: string | undefined): string | undefined {
  switch (call.op) {
    case "plan": return call.req.rootId;
    case "remember": case "pinpoint": case "history": case "syncStatus": case "applyFix": return call.rootId;
    case "deleteFact": return lastRoot;
    default: return undefined;
  }
}

/** Throws a localized refusal when `call` is a write/review aimed at a read-only pack root (a review's `run` needs a `plan` first). */
export function assertWritable(call: KnowledgeCall, lastRoot: string | undefined): void {
  const rootId = targetRoot(call, lastRoot);
  if (rootId && readOnlyPack(rootId)) {
    throw new Error(vscode.l10n.t("This knowledge pack is read-only — update it with BuilderForce: Update Knowledge Pack."));
  }
}
