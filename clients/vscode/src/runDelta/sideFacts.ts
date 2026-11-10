/**
 * One side's FACTS of a run delta (PRD 41 §C1 and the `DeltaPorts.facts` contract), from the folder's knowledge store:
 * the graph the knowledge view builds (`buildStoredGraph`, the ONE stored-graph builder) with the run's changed files swapped
 * to this side's extracts.
 *
 *   - Each changed file's extract on this side is read from the store's extract cache by its content hash; on a miss the code
 *     pack's extractor runs on the side's text through memory's `extractFile` (the same entry the editor's file watcher uses),
 *     which also caches it. A deleted file is absent from the side.
 *   - `findings`: the graph's findings with memory's `identityOf`; `imports`: the file→file `references` of the graph's
 *     outline (the whole graph, never the cut); `badges`: the file nodes' badges.
 *   - `meta`: the extractor version and the content-hash rule (the analyzers stay L3 `not_measured` this pass, so no tool
 *     versions are claimed); `manifestGeneration`: the store's generation; `merkleRoot`: memory's `merkleTree` over the side's
 *     `(path, hash)` manifest.
 *
 * No knowledge root for the repository (never reviewed, or outside every workspace folder) gives empty facts over the changed
 * files' own manifest: the static rules still run on the texts.
 */

import {
  buildStoredGraph, knownKeysCache, storedFileHashes, textDocument, type ModuleAliases,
} from "@builderforce/agent-tools/knowledge";
import { fileFactsStamp } from "@builderforce/agent-tools/node-file-facts";
import {
  CONTENT_HASH_RULE, EXTRACTOR_VERSION, MAX_NODES_CAP, extractFile, extractorStampMeta, identityOf, merkleTree, outlineOf, outlineRef, pathOfRef, srcRef,
  type FileFacts, type KnowledgeGraph, type KnowledgePack, type KnowledgeStore,
} from "@seanhogg/builderforce-memory/knowledge";
import { sideFileFacts } from "./sideFileFacts";
import { factIndexOf } from "../knowledge/factFindings";
import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import type { SideFacts, SideText } from "@builderforce/run-delta";
import { toKnowledgePath, toRepoPath, type RepoPlacement } from "./repoPlacement";

/** A repository's knowledge root, opened: what a side's facts are read from. */
export interface KnowledgeContext {
  rootId: string;
  /**
   * Where the repository sits relative to the knowledge root (`repoPlacement.ts`): a nested repository adds its folder
   * prefix, a repository above the opened folder strips the folder's own. Paths outside the root have no knowledge.
   */
  placement: RepoPlacement;
  /** The root's LOCAL store (never the replicated wrapper: a delta's cache writes are not shared work). */
  store: KnowledgeStore;
  manifest: IngestManifest;
  packs: KnowledgePack[];
  /** The store's fact generation (`meta.generation`), as text. */
  generation(): string;
  /** The root's path aliases (`rootModules`), for resolving the sides' FileFacts imports. Absent ⇒ none. */
  aliases?: ModuleAliases;
}

/**
 * One changed file on this side: its hash and text (no text: binary). `absent`: the file does not exist on this side. Neither
 * a hash nor `absent`: the side could not be resolved, so the stored graph's copy of it stands.
 */
export interface SideFile {
  path: string;
  hash?: string;
  text?: string;
  absent?: true;
}

/**
 * What the side was measured with: the packs' extractor version and the content-hash rule, plus the FileFacts extractor's
 * stamp (`extractorStampMeta(fileFactsStamp())`: its family/version and each grammar as a `grammar:<lang>` tool), so a
 * grammar or extractor change between the sides is not comparable (C9).
 */
const FACTS_STAMP = extractorStampMeta(fileFactsStamp());
const META: SideFacts["meta"] = {
  extractorVersion: EXTRACTOR_VERSION, contentHashRule: CONTENT_HASH_RULE,
  ...(FACTS_STAMP.extractor ? { extractor: FACTS_STAMP.extractor } : {}), tools: { ...(FACTS_STAMP.tools ?? {}) },
};

function emptyFacts(files: readonly SideFile[], generation: string, fileFacts?: ReadonlyMap<string, FileFacts>): SideFacts {
  const manifest = files.filter((f) => f.hash).map((f) => ({ path: f.path, hash: f.hash! }));
  return {
    manifestGeneration: generation, merkleRoot: merkleTree(manifest).root,
    findings: [], imports: new Map(), badges: new Map(), meta: META, ...(fileFacts ? { fileFacts } : {}),
  };
}

/** A knowledge path → its repo-relative path; undefined outside the repository. */
const repoPathOf = (placement: RepoPlacement, knowledgePath: string | undefined): string | undefined =>
  knowledgePath === undefined ? undefined : toRepoPath(placement, knowledgePath);

/** The file→file imports and the file badges of a graph, repository-relative. */
function graphShape(graph: KnowledgeGraph, prefix: RepoPlacement): Pick<SideFacts, "imports" | "badges"> {
  const outline = outlineOf(graph);
  const pathOf = (index: number): string | undefined => {
    const file = outline.files[index];
    return file ? repoPathOf(prefix, pathOfRef(outlineRef(outline, file)) ?? file.path) : undefined;
  };
  const imports = new Map<string, string[]>();
  for (const [from, to] of outline.links) {
    const a = pathOf(from), b = pathOf(to);
    if (a === undefined || b === undefined) continue;
    imports.set(a, [...(imports.get(a) ?? []), b]);
  }
  const badges = new Map<string, Readonly<Record<string, number | string>>>();
  outline.files.forEach((file, index) => {
    const p = pathOf(index);
    if (p !== undefined && file.badges) badges.set(p, file.badges);
  });
  for (const node of graph.nodes) {
    if (node.kind !== "file" || !node.badges) continue;
    const p = repoPathOf(prefix, pathOfRef(node.ref));
    if (p !== undefined) badges.set(p, { ...(badges.get(p) ?? {}), ...node.badges });
  }
  return { imports, badges };
}

/**
 * The facts of one side: the stored graph with `files` swapped in. `onError` hears an extract that failed (that file then
 * keeps no facts on this side); a failure to build the graph rejects.
 */
export async function sideFacts(ctx: KnowledgeContext | undefined, files: readonly SideFile[], onError?: (error: unknown) => void): Promise<SideFacts> {
  if (!ctx) {
    // No knowledge root: the side's listing is its changed files.
    const listing = new Set(files.filter((f) => !f.absent && f.hash !== undefined).map((f) => f.path));
    return emptyFacts(files, "0", await sideFileFacts({ rootId: "", files, listing, ...(onError ? { onError } : {}) }));
  }
  const { rootId, store, manifest, packs, placement: prefix } = ctx;
  // Only files inside the knowledge root are swapped; a repo path outside it has no facts there.
  files = files.filter((f) => toKnowledgePath(prefix, f.path) !== undefined);
  const at = (p: string): string => toKnowledgePath(prefix, p)!;
  const overrides = new Map<string, string | null>();
  for (const f of files) {
    if (f.absent) overrides.set(at(f.path), null);
    else if (f.hash !== undefined) overrides.set(at(f.path), f.hash);
  }
  const knownKeys = await knownKeysCache(store, rootId).get().catch(() => new Map());
  for (const f of files) {
    if (f.hash === undefined || f.text === undefined) continue;
    try {
      await extractFile({ rootId, path: at(f.path), hash: f.hash, doc: textDocument(rootId, at(f.path), f.text), packs, store, knownKeys });
    } catch (error) {
      onError?.(error);
    }
  }
  const graph = await buildStoredGraph({
    rootId, store, manifest, packs, hashOverrides: overrides,
    focus: files.filter((f) => f.hash !== undefined).map((f) => srcRef(rootId, at(f.path))),
    maxNodes: MAX_NODES_CAP,
  });
  const hashes = await storedFileHashes(manifest, rootId, overrides);
  const sideManifest = [...hashes].flatMap(([p, hash]) => {
    const path = repoPathOf(prefix, p);
    return path === undefined ? [] : [{ path, hash }];
  });
  const merkleRoot = merkleTree(sideManifest).root;
  // FileFacts of the changed files, resolved against THIS side's listing (the before listing for the before side).
  const index = factIndexOf(rootId);
  const fileFacts = await sideFileFacts({
    rootId, files, listing: new Set(sideManifest.map((e) => e.path)), ...(ctx.aliases ? { aliases: ctx.aliases } : {}), ...(onError ? { onError } : {}),
    // A file the run did not change is a router module by the root's current facts (knowledge space).
    isRouterFile: (repoFile) => { const k = toKnowledgePath(prefix, repoFile); return k !== undefined && !!index?.isRouterFile(k); },
  });
  const generation = ctx.generation();
  if (!graph) return { ...emptyFacts(files, generation, fileFacts), merkleRoot };
  return {
    manifestGeneration: generation,
    merkleRoot,
    findings: graph.findings.map((f) => ({ identity: identityOf(f), kind: f.kind, severity: f.severity, nodes: f.nodes, params: f.params })),
    ...graphShape(graph, prefix),
    meta: META,
    fileFacts,
  };
}

/**
 * A side's changed files: `hashOf` is the change set's hash of each file on this side (undefined: it does not exist there),
 * `texts` what the side resolved to. An unresolved side keeps the stored copy (no override).
 */
export function sideFilesOf(
  files: ReadonlyArray<{ path: string; hash?: string }>,
  texts: ReadonlyMap<string, SideText | { reason: string }>,
): SideFile[] {
  return files.map((f) => {
    if (f.hash === undefined) return { path: f.path, absent: true as const };
    const t = texts.get(f.path);
    if (!t || "reason" in t) return { path: f.path };
    return { path: f.path, hash: t.hash ?? f.hash, ...(t.text !== undefined ? { text: t.text } : {}) };
  });
}
