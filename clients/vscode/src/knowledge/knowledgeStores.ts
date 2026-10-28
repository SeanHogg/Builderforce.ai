/**
 * Where the editor keeps knowledge (PRD 38 §4.7, §5.1, §8.4):
 *
 *   - a workspace LINKED to a project (the editor's selected project) → the platform, through
 *     the ONE knowledge client (`@builderforce/knowledge-client`);
 *   - an unlinked folder → memory's `localSnapshotStore`, persisted as
 *     `.builderforce/knowledge/<root>.json` in the workspace folder, until it is linked.
 *
 * Linking UPLOADS the local snapshot ({@link uploadLocalSnapshot}): each reviewed source's
 * extracted output and current hash, then the facts and relations (the client chunks them,
 * ≤ 500 rows per call, the scope riding the last chunk), then a mark so the same snapshot
 * is not uploaded to the same project twice. Upserts use the platform's unique keys, so a
 * repeated upload is idempotent.
 *
 * The review's `IngestManifest` for a root is a JSON file beside its snapshot.
 *
 * Pure over {@link KnowledgeFiles} (the workspace-fs adapter is `knowledgeFs.ts`).
 */

import {
  filesManifestKey, localSnapshotStore, srcRef,
  type Extracted, type KnowledgeSnapshot, type KnowledgeStore, type ScopeRecord,
} from "@seanhogg/builderforce-memory/knowledge";
// The manifest and file names are the ONE disk rule (`.builderforce/knowledge/<stem>.*`,
// shared with the knowledge index and on-prem).
import {
  analysisManifestKey, fileManifest, manifestFileName, snapshotFileName, type KnowledgeFiles,
} from "@builderforce/agent-tools/knowledge";

import type { KnowledgeClient } from "@builderforce/knowledge-client";

export { fileManifest, manifestFileName, snapshotFileName, type KnowledgeFiles };

/** Which project each root's local snapshot was last uploaded to (`globalState`). */
export interface UploadMarks {
  get(rootId: string): number | undefined;
  set(rootId: string, projectId: number): Promise<void>;
}

/** The unlinked root's store: one canonical JSON snapshot beside its manifest. */
export function localKnowledgeStore(files: KnowledgeFiles, rootId: string): KnowledgeStore {
  const name = snapshotFileName(rootId);
  return localSnapshotStore({ read: () => files.read(name), write: (text) => files.write(name, text) });
}

export interface StoreChoice {
  store: KnowledgeStore;
  /** Present when the workspace is linked to a project. */
  client?: KnowledgeClient;
}

/** Linked ⇒ the platform; unlinked ⇒ the local snapshot (PRD 38 §8.4). */
export function selectKnowledgeStore(args: { rootId: string; files: KnowledgeFiles; client?: KnowledgeClient }): StoreChoice {
  return args.client ? { store: args.client.store, client: args.client } : { store: localKnowledgeStore(args.files, args.rootId) };
}

export interface UploadResult {
  sources: number;
  facts: number;
  relations: number;
}

/** Root-level outputs (analyzers) are keyed by a `~` digest, never by a source's content hash. */
const isSourceHash = (hash: string): boolean => !hash.startsWith("~");

/**
 * Uploads a root's local snapshot to the linked project. Null when there is nothing to
 * upload, or this snapshot already went to this project.
 */
export async function uploadLocalSnapshot(args: {
  rootId: string;
  files: KnowledgeFiles;
  client: KnowledgeClient;
  projectId: number;
  marks: UploadMarks;
}): Promise<UploadResult | null> {
  const { rootId, files, client } = args;
  if (args.marks.get(rootId) === args.projectId) return null;
  const text = await files.read(snapshotFileName(rootId));
  if (!text) return null;
  let snapshot: Partial<KnowledgeSnapshot>;
  try {
    snapshot = JSON.parse(text) as Partial<KnowledgeSnapshot>;
  } catch {
    return null;
  }
  const scope: ScopeRecord = snapshot.scopes?.find((s) => s.rootId === rootId) ?? { rootId, title: rootId, packs: [] };
  const manifest = fileManifest(files, manifestFileName(rootId));
  const extracted = snapshot.extracted ?? {};
  const current = [
    ...((await manifest.get(filesManifestKey(rootId))) ?? []).map((f) => ({ ref: srcRef(rootId, f.id) as string, hash: f.hash })),
    ...((await manifest.get(analysisManifestKey(rootId))) ?? []).map((r) => ({ ref: r.id, hash: r.hash })),
  ];

  let sources = 0;
  for (const { ref, hash } of current) {
    const entry: Extracted | undefined = extracted[hash]?.find((e) => e.sourceRef === ref);
    if (!entry) continue;
    await client.putExtracted(hash, [entry]);
    // Records the source's current hash on the platform (the graph lists the root by it).
    if (isSourceHash(hash)) await client.store.markStale({ rootId }, entry.sourceRef, hash);
    sources += 1;
  }
  const facts = snapshot.facts?.[rootId] ?? [];
  const relations = snapshot.relations?.[rootId] ?? [];
  await client.store.write({ scope, facts, relations });
  await args.marks.set(rootId, args.projectId);
  return { sources, facts: facts.length, relations: relations.length };
}
