/**
 * Linking replicates what was reviewed locally (§5.1; PRD 41 A7): each reviewed root's local snapshot
 * is queued for the project ONCE (the replica pump's first-sync case, marked per project), and a queue
 * left waiting by an earlier session resumes. The pump runs in the background; its state shows in the
 * Sync drawer. Unlinking stops every root's pump at once.
 */

import type * as vscode from "vscode";
import { reviewedRoots, rootById } from "./knowledgeRoots";
import { linkedKnowledgeClient, log, openRoot, workspaceFolders } from "./knowledgeService";
import { queueFirstSyncOnce, resumeReplica, stopReplicaPump, type UploadMarks } from "./knowledgeReplica";

/** The ONE globalState key recording which project each root's local snapshot went to. */
export const KNOWLEDGE_UPLOADED_KEY = "builderforce.knowledge.uploaded";

function uploadMarks(state: vscode.Memento): UploadMarks {
  const read = (): Record<string, number> => state.get<Record<string, number>>(KNOWLEDGE_UPLOADED_KEY) ?? {};
  return {
    get: (rootId) => read()[rootId],
    set: (rootId, projectId) => Promise.resolve(state.update(KNOWLEDGE_UPLOADED_KEY, { ...read(), [rootId]: projectId })),
  };
}

/**
 * Bind (`linked`) or unbind every reviewed root. Resolves true when every root was handled; a root that
 * failed is logged and makes the result false, so the caller treats the bind as not applied and retries.
 */
export async function replicateReviewedRoots(context: vscode.ExtensionContext, linked: boolean): Promise<boolean> {
  const marks = uploadMarks(context.globalState);
  let ok = true;
  for (const listed of reviewedRoots(context.workspaceState)) {
    // A root listed under its old id resolves to its current one (and its migrated files).
    const root = rootById(listed, workspaceFolders());
    if (!root) continue;
    try {
      // Unlinked (or the project changed): the old project's pump stops at once; it never sends another op.
      if (!linked || !linkedKnowledgeClient(context.secrets)) { await stopReplicaPump(root.rootId); continue; }
      const open = openRoot(context.secrets, root);
      if (!open.pump) continue;
      if (!(await queueFirstSyncOnce({ ...open.pump, manifest: open.manifest, marks }))) await resumeReplica(open.pump);
    } catch (error) {
      ok = false;
      log(`replicate ${root.rootId}`, error);
    }
  }
  return ok;
}
