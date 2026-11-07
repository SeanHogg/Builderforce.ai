/**
 * Where the editor keeps knowledge (PRD 38 §4.7, §5.1; PRD 41 A7):
 *
 *   - EVERY root, linked or not, is kept in memory's `localSnapshotStore`, persisted as
 *     `.builderforce/knowledge/<root>.json` in the workspace folder. It is the source of truth for
 *     drawing in every capability state;
 *   - a root LINKED to a project is also replicated to it: the review wraps this store in
 *     `replicatedKnowledgeStore` (agent-tools), the replica pump sends the queue
 *     (`knowledgeReplica.ts`). There is no second upload path: linking queues the local snapshot as
 *     the pump's first-sync case.
 *
 * The review's `IngestManifest` for a root is a JSON file beside its snapshot.
 *
 * Pure over {@link KnowledgeFiles} (the workspace-fs adapter is `knowledgeFs.ts`).
 */

import { localSnapshotStore, type KnowledgeStore } from "@seanhogg/builderforce-memory/knowledge";
// The manifest and file names are the ONE disk rule (`.builderforce/knowledge/<stem>.*`,
// shared with the knowledge index and on-prem).
import { extractedLogFileName, fileManifest, manifestFileName, snapshotFileName, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";

export { extractedLogFileName, fileManifest, manifestFileName, snapshotFileName, type KnowledgeFiles };

/** The extract cache as memory's `extractedLog` port over the root's `<stem>.extracted.jsonl` (append-only JSON Lines). */
export function extractedLogOf(files: KnowledgeFiles, rootId: string): { read(): Promise<string | undefined>; append(text: string): Promise<void> } {
  const name = extractedLogFileName(rootId);
  return {
    read: () => files.read(name),
    // A host without `append` rewrites the concatenation: slower, never wrong.
    append: files.append
      ? (text) => files.append!(name, text)
      : async (text) => files.write(name, `${(await files.read(name)) ?? ""}${text}`),
  };
}

/** A root's local store: one canonical JSON snapshot (scopes, facts, relations) beside its manifest and its extract-cache log. */
export function localKnowledgeStore(files: KnowledgeFiles, rootId: string): KnowledgeStore {
  const name = snapshotFileName(rootId);
  return localSnapshotStore({ read: () => files.read(name), write: (text) => files.write(name, text) }, { extractedLog: extractedLogOf(files, rootId) });
}
