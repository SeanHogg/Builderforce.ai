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
 * Everything here is pure + transport-agnostic (no fetch, no DOM) so it is unit
 * testable and shared verbatim by the web app and the VS Code webview.
 */

/** One learned memory the project's Evermind recalled for the current turn. */
export interface EvermindRecallItem {
  /** Stable id of the learned memory (targets a specific contribution). */
  id: number;
  /** Readable snippet of the learned exemplar (or the task it answered). */
  text: string;
  /** Lexical relevance to the query, 0..1. */
  score: number;
}

/**
 * What a recall returns: the project's learning posture (so the loop knows
 * whether the turn will also be CONTRIBUTED) plus the recalled memories. Mirrors
 * the api `recallProjectEvermindMemory` response.
 */
export interface EvermindRecallResult {
  /** True once the project has a base Evermind (version ≥ 1). */
  seeded: boolean;
  /** Current head version the recall ran against. */
  version: number;
  /** `connected` = runs/replies contribute back; `offline-frozen` = pinned, read-only. */
  mode: 'connected' | 'offline-frozen';
  /** Recalled memories, best-first. Empty when nothing lexically matched. */
  items: EvermindRecallItem[];
}

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
}

/**
 * The hooks a host injects into the run loop. Bound to the active chat's project.
 * `recall` grounds the answer (RAG); the OPTIONAL `answer`/`cacheAnswer` pair adds the
 * memory-first short-circuit — answer from the project's own memory (Q&A cache or
 * Evermind) BEFORE spending a model call, and remember a fresh (question→answer) pair
 * so the next exact repeat is free. All return null / no-op when the chat isn't
 * project-scoped or memory is unavailable, so the loop simply falls through to the LLM.
 */
export interface EvermindRunHooks {
  /** Recall the project's learned memories most relevant to `query`. */
  recall(query: string): Promise<EvermindRecallResult | null>;
  /** Try to answer `query` from memory WITHOUT the LLM; null → run the model. */
  answer?(query: string): Promise<MemoryFirstAnswer | null>;
  /** Remember a (question → answer) pair so an exact repeat short-circuits next time. */
  cacheAnswer?(query: string, answer: string): void | Promise<void>;
}

/**
 * Assistant text shorter than this isn't a teaching signal, so the server won't
 * contribute it. Mirrors `MIN_TEACH_CHARS` in the api's `brainEvermindLearning.ts`
 * so the "contributed to Evermind" step appears exactly when the server actually
 * contributes the turn — keep the two in sync.
 */
export const EVERMIND_LEARN_MIN_CHARS = 40;

/**
 * Fraction of a recalled memory's meaningful tokens the answer must restate for
 * the turn to count as RECONCILING (superseding) that memory. Write-Through
 * Cognition = an answer that re-states a prior learning updates it.
 */
const RECONCILE_OVERLAP = 0.6;

/** Tiny code+English stopword set — mirrors the api ranker so overlap keys on
 *  meaningful terms, not filler. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
  'be', 'as', 'at', 'by', 'it', 'this', 'that', 'from', 'you', 'your', 'i', 'we',
  'they', 'he', 'she', 'can', 'will', 'how', 'do', 'does', 'what', 'why', 'when',
  'which', 'use', 'using', 'used', 'please', 'need', 'want', 'me', 'my', 'so', 'if',
]);

/** Lowercase, split on non-word runs, drop stopwords + 1-char tokens (as the ranker does). */
function tokenSet(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length >= 2 && !STOP.has(w)));
}

/**
 * Build the `[Evermind Memory]` block injected into the system prompt — the part
 * that makes recall REAL (it changes what the model sees), not just a UI badge.
 * Numbered so the model can cite/correct a specific learning. Returns '' when
 * there is nothing to inject.
 */
export function formatEvermindMemoryBlock(items: EvermindRecallItem[]): string {
  if (items.length === 0) return '';
  const lines = items
    .map((it, i) => `${i + 1}. ${it.text.replace(/\s+/g, ' ').trim()}`)
    .filter((l) => l.length > 3);
  if (lines.length === 0) return '';
  return [
    "[Evermind Memory — recalled from this project's self-learning model]",
    'Prior learnings this project recalled as relevant to the request. Treat them as grounding; if any is outdated or wrong, correct it in your answer (this project learns write-through — your reply updates its memory).',
    ...lines,
  ].join('\n');
}

/**
 * How many recalled memories this answer RECONCILES — restates enough of, that
 * the contributed turn supersedes them. Pure heuristic over token overlap; used
 * only to surface the reconcile step, never to gate learning.
 */
export function countReconciledMemories(items: EvermindRecallItem[], answer: string): number {
  const ans = tokenSet(answer);
  if (ans.size === 0) return 0;
  let n = 0;
  for (const it of items) {
    const mem = tokenSet(it.text);
    if (mem.size === 0) continue;
    let hit = 0;
    for (const tok of mem) if (ans.has(tok)) hit++;
    if (hit / mem.size >= RECONCILE_OVERLAP) n++;
  }
  return n;
}
