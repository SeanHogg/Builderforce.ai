/**
 * The context pack's KNOWLEDGE part (docs/design/deterministic-knowledge-index.md,
 * "Consumers"): the workspace root's knowledge index asked about the request — exact +
 * lexical hits (dense only while an embedder is warm), expanded one hop over the graph's
 * neighbours — rendered with paths into the pack's volatile tail, beside the pre-search
 * hits (`preSearchSource.ts` wires both under the SAME deadline).
 *
 * Recall and rendering are split so the pre-search can start both at once and still drop
 * every knowledge hit whose file the pre-search already names. Late, failed or empty ⇒ no
 * part, never a run failure. Pure Node (no `vscode` import).
 */

import {
  knowledgeSubject,
  renderKnowledgeContext,
  type HostKnowledgeIndexCore,
  type Recall,
} from "@builderforce/agent-tools/knowledge-index";
import type { PreSearchResult } from "@builderforce/agent-tools";
import { workspaceKnowledgeIndex } from "../knowledge/index/hostKnowledgeIndex";
import { withinMs } from "./withinMs";

/** Hits the part carries — a pointer list, not a dump. */
export const KNOWLEDGE_PART_HITS = 6;

export interface KnowledgeRecall {
  query: string;
  recall: Recall;
}

export interface KnowledgeRecallOptions {
  /** The run's Stop: no part once it fires. */
  signal?: AbortSignal;
  /** The workspace's index; default the editor's (`hostKnowledgeIndex.ts`). */
  index?: (root: string) => HostKnowledgeIndexCore;
}

/** The index's recall for `request`, or undefined when there is none within `deadlineMs` (or on Stop). */
export function knowledgeRecall(root: string, request: string, deadlineMs: number, opts: KnowledgeRecallOptions = {}): Promise<KnowledgeRecall | undefined> {
  if (!root || !request.trim() || opts.signal?.aborted) return Promise.resolve(undefined);
  const query = knowledgeSubject(request) ?? request.trim();
  const work = (opts.index ?? workspaceKnowledgeIndex)(root)
    .recall(query, { k: KNOWLEDGE_PART_HITS })
    .then((recall): KnowledgeRecall | undefined => (recall.hits.length ? { query, recall } : undefined))
    .catch(() => undefined);
  const stopped = new Promise<undefined>((resolve) => opts.signal?.addEventListener("abort", () => resolve(undefined), { once: true }));
  return withinMs(Promise.race([work, stopped]), deadlineMs, undefined);
}

/** The files the pre-search already names — the knowledge part leaves them out. */
export function preSearchPaths(r: Pick<PreSearchResult, "definitions" | "references"> | undefined): Set<string> {
  return new Set([...(r?.definitions ?? []), ...(r?.references ?? [])].map((x) => x.path));
}

/** The knowledge part, '' when nothing new is left after the pre-search's files. */
export function knowledgePart(k: KnowledgeRecall | undefined, exclude: ReadonlySet<string>): string {
  if (!k) return "";
  return renderKnowledgeContext(k.query, k.recall.hits, k.recall.tiers, { exclude, max: KNOWLEDGE_PART_HITS });
}
