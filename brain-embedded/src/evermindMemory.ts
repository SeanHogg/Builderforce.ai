/**
 * Evermind memory hooks for the Brain run loop — the client half of "recall +
 * learn + reconcile, visible in the chat".
 *
 * A project-scoped Brain conversation now (a) RECALLS the project's learned
 * memories before answering and injects them into the prompt, and (b) surfaces
 * that its turn will be CONTRIBUTED back (and which recalled memories it
 * RECONCILES) — each as its own timeline step, the same way a Claude Code
 * `memory_recall` shows as a step. The heavy lifting (the corpus + the ranker)
 * lives server-side; the host injects a single {@link EvermindRunHooks.recall}
 * callback bound to the active chat's project, and the run loop
 * ({@link ./brainRunStore}) turns the result into the injected memory block plus
 * the recall/learn/reconcile trace events.
 *
 * The recall CONTRACT, the memory block and the reconcile rule are the Evermind
 * module's (`@seanhogg/builderforce-memory/evermind`); what lives here is the Brain's
 * own port — the hooks a host injects and the one server-backed implementation of them.
 */

import type { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import type { UsageSurface } from '@builderforce/spend-contract';

/**
 * A memory-first answer that lets the run loop SKIP the paid model entirely — either
 * an exact-repeat Q&A cache hit or the project's Evermind SSM. Returned by the opt-in
 * {@link EvermindRunHooks.answer} hook; null means "memory can't answer, run the LLM".
 */
export interface MemoryFirstAnswer {
  /** The answer text to adopt as the assistant turn. */
  text: string;
  /** Where it came from — drives the "no LLM" provenance/step. */
  source: 'qa-cache' | 'evermind';
  /** Evermind head version, when `source === 'evermind'`. */
  evermindVersion?: number;
  /**
   * WHICH Evermind answered (project id), when `source === 'evermind'`. A project can
   * target several heads (its own plus the IDE builds grouped under it), so without
   * this the timeline could not say which one served — and a chat whose OWN project
   * reports inference OFF could still be answered by a sibling head with no way to
   * tell. Recorded on the trace step so a memory hit is triageable.
   */
  evermindProjectId?: number;
}

/**
 * The hooks a host injects into the run loop. Bound to the active chat's project.
 * `recall` grounds the answer (RAG); the OPTIONAL `answer`/`cacheAnswer` pair adds the
 * memory-first short-circuit — answer from the project's own memory (Q&A cache or
 * Evermind) BEFORE spending a model call, and remember a fresh (question→answer) pair
 * so the next exact repeat is free. All return null / no-op when the chat isn't
 * project-scoped or memory is unavailable, so the loop simply falls through to the LLM.
 */
/** Where a run is driven from — the usage ledger's `surface` vocabulary, declared once. */
export type MemorySurface = UsageSurface;

/** How a memory-first answer is asked for. */
export interface MemoryAnswerOptions {
  /** Whether THIS run can call tools — see {@link EvermindRunHooks.answer}. */
  toolsAvailable: boolean;
  /** The model the run would otherwise call, for pricing a saving. */
  model?: string;
  /** A verification read (the compaction recall probe): answered, but no saving is
   *  recorded, because no model call was ever going to happen. */
  probe?: boolean;
}

/** What producing a cached answer cost — recorded with it (`project_facts.origin_*`). */
export interface AnswerOriginCost {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * A file a cached answer was about. `contentHash` when the host knows it; otherwise the
 * server stamps it from its directory index at write time, and a later change to that
 * file makes the cached answer stale instead of replayable.
 */
export interface AnswerFileAnchor {
  path: string;
  contentHash?: string;
}

/** Anchors derived from an answer's own text, at most this many. */
const MAX_CITED_ANCHORS = 16;

/**
 * Repo-relative file paths an answer CITES (`api/src/auth.ts`, `` `src/a.tsx:12` ``) —
 * the fallback anchors when the run cannot say which files it read. A token counts only
 * with a directory separator AND an extension, so prose ("and/or", "v1.2") is never
 * mistaken for a file. A URL never matches: its segments are not preceded by a boundary.
 */
export function citedPathAnchors(answer: string): AnswerFileAnchor[] {
  const out: AnswerFileAnchor[] = [];
  const seen = new Set<string>();
  const re = /(?:^|[\s`'"(\[])((?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,8})(?::\d+)?(?=$|[\s`'"),.:;\]])/g;
  for (const m of (answer ?? '').matchAll(re)) {
    const path = m[1]!.replace(/^\.\/+/, '');
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path });
    if (out.length >= MAX_CITED_ANCHORS) break;
  }
  return out;
}

export interface EvermindRunHooks {
  /** Recall the project's learned memories most relevant to `query`. */
  recall(query: string): Promise<EvermindRecallResult | null>;
  /**
   * Try to answer `query` from memory WITHOUT the LLM; null → run the model.
   *
   * `opts.toolsAvailable` tells the resolver whether THIS run can call tools. It must
   * be honest: the Evermind SSM has no tool-calling, so when tools are available the
   * server serves only the Q&A cache (a replay of an answer a real model produced) and
   * never a fresh SSM generation — otherwise a request whose answer lives behind a tool
   * call ("which tickets are in the backlog?") gets answered from stale weights while
   * the tools that could answer it are never called.
   */
  answer?(query: string, opts: MemoryAnswerOptions): Promise<MemoryFirstAnswer | null>;
  /**
   * Remember a (question → answer) pair so an exact repeat short-circuits next time.
   * `origin` is what producing the answer cost (the run's served model + summed tokens):
   * stored with it, so each replay's saving is a recorded figure, not an estimate.
   * `fileAnchors` are the files the turn read: the server drops the cached answer once
   * one of them changes. Absent → the server-backed hooks derive them from the paths
   * the answer cites ({@link citedPathAnchors}).
   */
  cacheAnswer?(query: string, answer: string, origin?: AnswerOriginCost, fileAnchors?: AnswerFileAnchor[]): void | Promise<void>;
}

/**
 * The host's authenticated JSON transport, as a port. Both Brain hosts already have
 * one (`apiRequest` on the web, the webview's `authedFetch`); this is the intersection
 * the memory hooks need, so neither has to hand it a bespoke wrapper.
 */
export type ProjectMemoryRequest = <T>(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<T>;

/**
 * The project's SERVER-side memory hooks, built once for every host.
 *
 * The three calls — recall, memory-first answer, write-through — are the same routes
 * with the same query parameters and the same "a failure is not an error, it is just
 * no memory" contract wherever the Brain runs. They were hand-written per host, and
 * the copies had drifted: the web surfaces passed only `recall` (one of them plus a
 * `learn` callback this interface has never had, so it was dead), while only the VS
 * Code webview had the memory-first pair at all. Same loop, three different memories.
 *
 * `toolsAvailable` is threaded through honestly, because the server uses it to decide
 * whether the Evermind SSM leg may run: it cannot call a tool, so on a run that could
 * fetch the real answer it must never pre-empt the model from stale weights.
 */
export function projectMemoryHooks(
  projectId: number,
  request: ProjectMemoryRequest,
  /**
   * The chat these hooks are bound to, when the host knows it.
   *
   * Recall is TIERED on it: this conversation's own memories come first, then the
   * wider project's. Without it the server ranks project-wide, which is what made a
   * reopened chat "remember" turns from other conversations. Optional because a global
   * (project-less) chat and the non-chat callers genuinely have none — those recall
   * project-wide exactly as before.
   */
  chatId?: number | null,
  /** Which surface the run is driven from — recorded on the saving a memory answer
   *  makes, so "saved" splits by editor / web / browser like "spent" does. */
  surface: MemorySurface = 'web',
): EvermindRunHooks {
  const json = { 'Content-Type': 'application/json' };
  // Server chat ids only: a local-first chat's negative id is not a server chat yet.
  const chatParam = chatId != null && chatId > 0 ? `&chatId=${chatId}` : '';
  return {
    recall: (query: string) =>
      request<EvermindRecallResult>(`/api/projects/${projectId}/evermind/recall`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ query, ...(chatId != null ? { chatId } : {}) }),
      }).catch(() => null),
    answer: (query: string, opts: MemoryAnswerOptions) =>
      request<{ answer: MemoryFirstAnswer | null }>(
        `/api/projects/${projectId}/answer?query=${encodeURIComponent(query)}&tools=${opts.toolsAvailable ? '1' : '0'}`
          + `${chatParam}&surface=${surface}${opts.model ? `&model=${encodeURIComponent(opts.model)}` : ''}${opts.probe ? '&probe=1' : ''}`,
      ).then((r) => r?.answer ?? null).catch(() => null),
    cacheAnswer: (query: string, answer: string, origin?: AnswerOriginCost, fileAnchors?: AnswerFileAnchor[]) => {
      // The files the answer is about — what makes it stale server-side. The run's own
      // reads when the loop passed them; otherwise the paths the answer cites (a host
      // that layers these hooks may not forward the fourth argument).
      const anchors = fileAnchors?.length ? fileAnchors : citedPathAnchors(answer);
      void request(`/api/projects/${projectId}/answer`, {
        method: 'POST',
        headers: json,
        // `chatId` is what the server prices the cached answer from (that chat's own
        // usage row) and gates on (its Memory switch); `origin` only serves an older API.
        body: JSON.stringify({
          question: query, answer,
          ...(chatId != null && chatId > 0 ? { chatId } : {}),
          ...(origin ? { origin } : {}),
          ...(anchors.length ? { fileAnchors: anchors } : {}),
        }),
      }).catch(() => { /* best-effort: never fail a reply to remember it */ });
    },
  };
}
