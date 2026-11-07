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

import { localSnapshotStore, type ExtractedLogPersistence, type LocalSnapshotStore } from "@seanhogg/builderforce-memory/knowledge";
// The manifest and file names are the ONE disk rule (`.builderforce/knowledge/<stem>.*`,
// shared with the knowledge index and on-prem).
import { extractedLogFileName, fileManifest, manifestFileName, snapshotFileName, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";

export { extractedLogFileName, fileManifest, manifestFileName, snapshotFileName, type KnowledgeFiles };

/** The extract cache as memory's `extractedLog` port over the root's `<stem>.extracted.jsonl` (append-only JSON Lines). */
export function extractedLogOf(files: KnowledgeFiles, rootId: string): ExtractedLogPersistence {
  const name = extractedLogFileName(rootId);
  /** A whole-file write that is never torn in place: a temp file, then a rename over the target (when the host can rename). */
  const writeWhole = async (text: string): Promise<void> => {
    if (!files.rename) return files.write(name, text);
    const temp = `${name}.tmp`;
    await files.write(temp, text);
    await files.rename(temp, name);
  };
  // The read-modify-write fallback and `replace` share the temp name, so they run one at a time.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task);
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    read: () => files.read(name),
    // A host without `append` rewrites the concatenation (through a temp file when it can rename): slower, never wrong.
    append: files.append
      ? (text) => files.append!(name, text)
      : (text) => exclusive(async () => writeWhole(`${(await files.read(name)) ?? ""}${text}`)),
    ...(files.rename ? { replace: (text: string) => exclusive(() => writeWhole(text)) } : {}),
  };
}

/** A root's local store: one canonical JSON snapshot (scopes, facts, relations) beside its manifest and its extract-cache log. */
export function localKnowledgeStore(files: KnowledgeFiles, rootId: string): LocalSnapshotStore {
  const name = snapshotFileName(rootId);
  return localSnapshotStore(
    {
      read: () => files.read(name),
      write: (text) => files.write(name, text),
      // A snapshot that does not parse is kept beside it before the store starts empty.
      keepAside: (text) => files.write(`${name}.corrupt`, text),
    },
    { extractedLog: extractedLogOf(files, rootId) },
  );
}
