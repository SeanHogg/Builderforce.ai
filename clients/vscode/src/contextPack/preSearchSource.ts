/**
 * The run's DETERMINISTIC pre-turn parts (cost levers, WS-L), all from the workspace's
 * definition index + ripgrep, none calling a model:
 *
 *   - the pre-search hits block appended to the context pack (below);
 *   - the "where is X defined?" answer the run adopts instead of calling a model.
 *
 * The context pack's PRE-SEARCH part: the identifiers the request
 * names, looked up in the workspace's definition index and searched with ripgrep before
 * turn 1 — a bounded hits block, no model call. Kept beside, not inside,
 * `buildContextPack.ts`: the pack's own fan-out is untouched, and the hits are appended as
 * their own section (`withPreSearch`), under the same ~1.5 s deadline.
 *
 * Pure Node (no `vscode` import).
 */

import { answerWhereDefined, preSearch, whereDefinedTargets, type RepoSymbolsCapability } from "@builderforce/agent-tools";
import type { RunContextPack } from "../brainRunHostContract";
import { findRipgrep } from "../ripgrep";
import { searchWorkspace } from "../workspaceSearch";
import { workspaceSymbolIndex } from "../workspaceSymbols";
import { REQUEST_SYMBOL_LIMIT } from "./requestSymbols";
import { withinMs } from "./withinMs";

export interface PreSearchBlockOptions {
  /** The run's shared symbol look-up (`requestSymbolLookup`), so the pack's areas and
   *  these hits ask the index once; absent ⇒ the workspace index directly. */
  symbols?: Pick<RepoSymbolsCapability, "find">;
  /** The run's Stop: ends the searches before the deadline does. */
  signal?: AbortSignal;
}

/** The hits block for `request` in the workspace at `root`, '' when none or later than
 *  `deadlineMs` (the pack's own deadline, `CONTEXT_PACK_DEADLINE_MS`). At the deadline
 *  (or on Stop) every ripgrep the pre-search started is killed — none outlives the pack. */
export async function preSearchBlock(root: string, request: string, deadlineMs: number, opts: PreSearchBlockOptions = {}): Promise<string> {
  if (!root || !request.trim()) return "";
  // Aborted the moment the race settles — at the deadline at the latest — or on Stop.
  const stop = new AbortController();
  const onStop = () => stop.abort(opts.signal?.reason);
  if (opts.signal?.aborted) stop.abort(opts.signal.reason);
  else opts.signal?.addEventListener("abort", onStop, { once: true });
  try {
    const symbols = opts.symbols ?? workspaceSymbolIndex(root);
    const ripgrep = findRipgrep().catch(() => null);
    const work = preSearch(request, {
      findSymbol: (name) => symbols.find(name, { limit: REQUEST_SYMBOL_LIMIT }),
      searchText: async (query, signal) => searchWorkspace({ root, start: root, query, ripgrep: await ripgrep, ...(signal ? { signal } : {}) }),
    }, { signal: stop.signal }).then((r) => r.block);
    return await withinMs(work, deadlineMs, "");
  } finally {
    opts.signal?.removeEventListener("abort", onStop);
    // Done or late, anything still searching is no longer wanted: kill it.
    stop.abort(new Error("pre-search settled"));
  }
}

/**
 * The model-free answer to "where is X defined?" (`answerWhereDefined`) when the index
 * resolves every name the request asks about; undefined otherwise, or when the index
 * cannot answer within `deadlineMs` — the run then proceeds to the model as before.
 */
export function whereDefinedAnswer(root: string, request: string, deadlineMs: number): Promise<string | undefined> {
  if (!root || !whereDefinedTargets(request)) return Promise.resolve(undefined);
  const work = answerWhereDefined(request, (name) => workspaceSymbolIndex(root).find(name, { limit: 50 })).then((a) => a ?? undefined);
  return withinMs<string | undefined>(work, deadlineMs, undefined);
}

/** The pack with the hits appended as their own section; a pack of only hits when the
 *  pack itself had nothing to build from. */
export async function withPreSearch<P extends RunContextPack>(
  pack: Promise<P | undefined>,
  hits: Promise<string>,
): Promise<RunContextPack | undefined> {
  const [built, block] = await Promise.all([pack, hits.catch(() => "")]);
  if (!block) return built;
  if (!built) return { block, recallHint: "", servedReads: [] };
  return { ...built, block: built.block ? `${built.block}\n\n${block}` : block };
}
