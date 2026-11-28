/**
 * BuilderForceAgentsLLM retrieval context for the local-model path.
 *
 * Retrieval is the ONE on-prem code index (`resolveOnPremSemantic`: Builderforce Desktop when it
 * answers, else the workspace code index of `@builderforce/workspace-mcp`); this module only
 * shapes its hits into the context block the local stream injects.
 */

import type { RepoSemanticCapability } from "@builderforce/agent-tools";
import { resolveOnPremSemantic } from "./on-prem-semantic.js";
import { logWarn } from "../logger.js";

const MAX_EXCERPT_CHARS = 600;
const DEFAULT_TOP_K = 3;
/** Hits asked of the index per wanted file: several definitions of one file collapse to its best hit. */
const HITS_PER_FILE = 4;

/**
 * Returns a formatted string of the most relevant file excerpts for the query.
 * Returns an empty string when the workspace has no matching files.
 */
export async function retrieveRelevantContext(opts: {
  query: string;
  workspaceDir: string;
  topK?: number;
  maxExcerptChars?: number;
  /** The code index to query. Default: the ONE on-prem resolver (Desktop probe, else the workspace index); a test injects a hermetic one. */
  semantic?: RepoSemanticCapability;
}): Promise<string> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const maxChars = opts.maxExcerptChars ?? MAX_EXCERPT_CHARS;
  if (!opts.query.trim()) return "";

  let found;
  try {
    const semantic = opts.semantic ?? (await resolveOnPremSemantic(opts.workspaceDir));
    found = await semantic.search(opts.query, { limit: topK * HITS_PER_FILE });
  } catch (err) {
    logWarn(`local-model retrieval failed, continuing without codebase context: ${err instanceof Error ? err.message : String(err)}`);
    return "";
  }
  if (!found.ok) return "";
  if (found.indexing === true && (found.results ?? []).length === 0) {
    // The index was still being built when the wait ran out: an empty context here is "not ready", not "no match".
    logWarn("local-model retrieval: the code index is still being built, so this turn has no codebase context");
  }

  const bestPerFile = new Map<string, string>();
  for (const hit of found.results ?? []) {
    if (bestPerFile.size >= topK) break;
    if (!bestPerFile.has(hit.path)) {
      bestPerFile.set(hit.path, hit.snippet.slice(0, maxChars) + (hit.snippet.length > maxChars ? "\n…" : ""));
    }
  }
  if (bestPerFile.size === 0) return "";

  const sections = [...bestPerFile].map(([file, excerpt]) => `### ${file}\n${excerpt}`);
  return `## Relevant codebase context\n\n${sections.join("\n\n")}`;
}
