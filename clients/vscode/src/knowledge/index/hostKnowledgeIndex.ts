/**
 * The editor's knowledge index per root (docs/design/deterministic-knowledge-index.md,
 * "Where it runs"; PRD 38 §4.7) — the PINNED seam the knowledge host (review runner,
 * graph panel, stores) imports:
 *
 *   getHostKnowledgeIndex(rootId) → { search, similar, nearDuplicates, upsertFromGraph, discardProvisional }
 *
 * One index per root id, loaded lazily from `<workspace>/.builderforce/knowledge/<rootId>.idx`
 * through the workspace fs (handed in at activation, `activateKnowledgeIndex.ts`) and
 * persisted atomically after compaction. The workspace repository's own root is seeded from
 * the code pack over the editor's definition index on first use, and re-seeded (debounced)
 * on save. The rules — lazy load, fingerprint mismatch ⇒ re-embed on idle, churn ⇒
 * compact, persist by digest — are the shared registry's
 * (`@builderforce/agent-tools/knowledge-index`); this file only supplies the editor's ports.
 *
 * No `vscode` import: the workspace folders and fs are configured at activation; before
 * that (tests, the harness) indexes live in memory.
 */

import {
  KNOWLEDGE_IDLE_MS,
  createKnowledgeIndexRegistry,
  debouncedIdle,
  type HostKnowledgeIndex,
  type HostKnowledgeIndexCore,
  type IdleScheduler,
  type KnowledgeIndexFiles,
  type KnowledgeIndexRegistry,
  type SymbolFile,
} from "@builderforce/agent-tools/knowledge-index";
import type { EmbedderPort } from "@seanhogg/builderforce-memory/knowledge";
import { knowledgeRootId } from "../knowledgeRoots";
import { workspaceSymbolIndex } from "../../workspaceSymbols";
import { editorEmbedder } from "./embedderPort";

export type { HostKnowledgeIndex, HostKnowledgeIndexCore };
export type { IndexHit, SimilarPair } from "@seanhogg/builderforce-memory/knowledge";

export interface EditorKnowledgeIndexConfig {
  /** Absolute workspace folders, read per call. */
  workspaceRoots: () => readonly string[];
  /** The workspace fs; absent ⇒ in memory only. */
  files?: KnowledgeIndexFiles;
  embedder?: () => Promise<EmbedderPort | undefined>;
  idle?: IdleScheduler;
  /** The definition index's files for a workspace root; default the editor's shared index. */
  symbolFiles?: (root: string) => Promise<SymbolFile[]>;
  /** Where background failures are reported (the output channel at activation). */
  onError?: (e: unknown) => void;
}

const warn = (e: unknown): void => console.warn(`[knowledge-index] ${e instanceof Error ? e.message : String(e)}`);

function build(config: EditorKnowledgeIndexConfig): KnowledgeIndexRegistry {
  const logError = config.onError ?? warn;
  return createKnowledgeIndexRegistry({
    workspaceRoots: config.workspaceRoots,
    rootIdOf: knowledgeRootId,
    symbolFiles: config.symbolFiles ?? ((root) => workspaceSymbolIndex(root).filesUnder()),
    ...(config.files ? { files: config.files } : {}),
    embedder: config.embedder ?? editorEmbedder,
    idle: config.idle ?? debouncedIdle(KNOWLEDGE_IDLE_MS, logError),
    onError: logError,
  });
}

let registry: KnowledgeIndexRegistry = build({ workspaceRoots: () => [] });

/** Activation (and tests): the workspace folders, the fs and, optionally, the other ports. Drops loaded indexes. */
export function configureHostKnowledgeIndex(config: EditorKnowledgeIndexConfig): void {
  registry = build(config);
}

/** The index of `rootId` — the pinned seam. */
export function getHostKnowledgeIndex(rootId: string): Promise<HostKnowledgeIndex> {
  return Promise.resolve(registry.get(rootId));
}

/** The workspace folder's own index (seeded from the code pack) — the context pack and `knowledge.ask` read it. */
export function workspaceKnowledgeIndex(workspaceRoot: string): HostKnowledgeIndexCore {
  return registry.forWorkspace(workspaceRoot);
}

/** A file was saved or deleted: re-seed its workspace root's code cards (debounced). */
export function markKnowledgeFileChanged(absPath: string): void {
  registry.fileChanged(absPath);
}
