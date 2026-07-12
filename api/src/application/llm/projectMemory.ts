/**
 * projectMemory — the ONE shared "answer from memory, skip the LLM" capability.
 *
 * Every agent loop (web + VS Code webview Brain, the VS Code native participant, the
 * cloud engine, the on-prem runner) has the SAME need: before spending a paid model
 * call, check whether the project's own memory already holds the answer. That logic —
 * the exact-repeat Q&A cache, the Evermind-first gate, and the substantive-reply
 * threshold — lived only inside the cloud engine (model-pin based). It is extracted
 * here so all four surfaces call the SAME implementation instead of re-deriving it,
 * and so the storage stays exactly where the operator wants it: the builderforce-memory
 * fact tier (`project_facts`) plus the project's Evermind SSM.
 *
 * Storage:
 *   - Q&A cache   → `project_facts` rows under key `qa:<hash(question)>`, source
 *                   `qa-cache` (excluded from the RAG facts block by projectFacts).
 *   - Evermind    → the project's registered SSM head (opt-in via `inferenceEnabled`).
 *
 * Pure of any transport: how to actually RUN the Evermind ref is injected (`runEvermind`)
 * because each surface already owns an LLM proxy — this module owns the DECISION, not
 * the wire. Never throws; a miss degrades to `null` so the caller proceeds to the LLM.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveEvermindTargets, recordEvermindServeOutcome } from './projectEvermind';
import { getProjectFactByKey, upsertProjectFact, QA_CACHE_SOURCE } from './projectFacts';
import { EVERMIND_ANSWER_MIN_CHARS, looksLikeCoherentText } from './textCoherence';

// Re-exported from the shared, zero-dep coherence module so existing importers
// (BrainService, the memory tests) keep resolving these from projectMemory — one
// home for "is this a real, coherent answer" across every surface (DRY).
export { EVERMIND_ANSWER_MIN_CHARS, looksLikeCoherentText };

/** Where a memory-first answer came from — drives the provenance chip the surfaces render. */
export type MemoryAnswerSource = 'qa-cache' | 'evermind';

export interface MemoryAnswer {
  text: string;
  source: MemoryAnswerSource;
  /** Present when `source === 'evermind'` — the head version that served it. */
  evermindVersion?: number;
  /** Present when `source === 'evermind'` — WHICH Evermind (project id) answered, so a
   *  multi-Evermind project's memory hit is triageable. */
  evermindProjectId?: number;
}

export interface ResolveMemoryDeps {
  /**
   * Run the project's Evermind SSM (hard-pinned, no cascade) on `question`, returning
   * its raw text or null on miss/error. Injected by the caller, which already owns an
   * LLM proxy — this module never touches the wire. Omit to disable the Evermind leg
   * (Q&A cache still applies).
   */
  runEvermind?: (ref: string, question: string) => Promise<string | null>;
}

/** Normalize a question so trivial vari(spacing/case/punctuation) hit the same cache row. */
function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic FNV-1a hash → 8-char hex. Stable across processes (no Date/random),
 *  so the same question always maps to the same cache key on every surface. */
function hashQuestion(normalized: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The stable `project_facts` key a question's cached answer lives under. Exported so
 *  the writer and reader (and tests) agree on the one key derivation. */
export function qaCacheKey(question: string): string {
  return `qa:${hashQuestion(normalizeQuestion(question))}`;
}

/**
 * Resolve an answer from memory WITHOUT calling a paid LLM, or null when memory can't
 * confidently answer (caller then runs the normal loop). Order:
 *   1. Exact-repeat Q&A cache (deterministic key match) — zero model cost.
 *   2. Evermind-first — only when the project opted in (`inferenceEnabled`, version ≥ 1)
 *      AND the SSM returns a substantive reply.
 */
export async function resolveMemoryAnswer(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  question: string,
  deps: ResolveMemoryDeps = {},
): Promise<MemoryAnswer | null> {
  const q = (question ?? '').trim();
  if (!q || !Number.isInteger(projectId) || projectId <= 0) return null;

  // 1) Exact-repeat Q&A cache.
  const cached = await getProjectFactByKey(env, db, tenantId, projectId, qaCacheKey(q)).catch(() => null);
  if (cached && cached.trim().length > 0) {
    return { text: cached.trim(), source: 'qa-cache' };
  }

  // 2) Evermind-first (opt-in). A project can target MANY Everminds (its own head + the
  // IDE builds grouped under it); try each inference-enabled, seeded one in order and
  // adopt the FIRST substantive reply. Same resolver every surface uses.
  if (deps.runEvermind) {
    const targets = (await resolveEvermindTargets(env, db, tenantId, projectId).catch(() => []))
      .filter((h) => h.inferenceEnabled && h.version >= 1 && h.ref);
    for (const head of targets) {
      const text = await deps.runEvermind(head.ref as string, q).catch(() => null);
      // Adopt only a SUBSTANTIVE and COHERENT reply. An under-trained head emits
      // fluent-looking gibberish that clears the length bar; `looksLikeCoherentText`
      // rejects it so we fall through to the next head / the LLM (a garbled reply
      // IS a miss) rather than answering the user in garbage.
      const coherent = !!text && text.trim().length >= EVERMIND_ANSWER_MIN_CHARS && looksLikeCoherentText(text);
      // Feed the outcome to the head's quarantine counter: a run that produced text
      // but failed the coherence bar counts as a failure; N in a row auto-disables
      // inference on that head so it stops serving (and wasting a call). A null text
      // is a transport miss (not the model's fault) → don't penalise it.
      if (text != null) {
        await recordEvermindServeOutcome(env, db, tenantId, head.projectId, coherent).catch(() => { /* best-effort */ });
      }
      if (coherent) {
        return { text: (text as string).trim(), source: 'evermind', evermindVersion: head.version, evermindProjectId: head.projectId };
      }
    }
  }

  return null;
}

/**
 * Persist a (question → answer) pair to the Q&A cache so the next exact repeat
 * short-circuits. Write-through by stable key (replace-on-write). Best-effort: a
 * failure never affects the reply. Skips trivially short answers (nothing to cache)
 * and answers already served FROM memory (no point re-caching what we just replayed).
 */
export async function cacheProjectAnswer(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  question: string,
  answer: string,
): Promise<void> {
  const q = (question ?? '').trim();
  const a = (answer ?? '').trim();
  // Never cache garbage: an incoherent answer must not be replayed O(1) on the next
  // repeat (it would pin the gibberish permanently under the Q&A key).
  if (!q || a.length < EVERMIND_ANSWER_MIN_CHARS || !looksLikeCoherentText(a) || !Number.isInteger(projectId) || projectId <= 0) return;
  await upsertProjectFact(env, db, tenantId, projectId, qaCacheKey(q), a, QA_CACHE_SOURCE).catch(() => {
    /* best-effort — caching never breaks a reply */
  });
}
