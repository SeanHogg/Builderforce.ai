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
import { getProjectEvermindHead, resolveEffectiveEvermindProjectId, recordEvermindServeOutcome } from './projectEvermind';
import { getProjectFactByKey, upsertProjectFact, QA_CACHE_SOURCE } from './projectFacts';
import { EVERMIND_ANSWER_MIN_CHARS, looksLikeCoherentText, isServableText } from './textCoherence';

// Re-exported from the shared, zero-dep coherence module so existing importers keep
// resolving these from projectMemory — one home for "is this a real, coherent answer"
// across every surface (DRY).
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
  /**
   * Whether the CALLING RUN has tools available. Default `true` (safe), which BARS
   * the Evermind leg.
   *
   * The Evermind SSM has no function-calling (see the `evermind` vendor's
   * `supportsTools: false`), so it can only answer from what it has already learned —
   * never from live data and never by DOING anything. Letting it short-circuit a
   * tool-capable run meant a request like "list the backlog and fix the code" (or even
   * "what project is this chat on?") was answered from stale weights while the tools
   * that could actually answer it were never called. The Q&A cache leg is unaffected:
   * it replays an answer a real model already produced.
   *
   * Pass `false` only for a genuinely tool-less caller.
   */
  toolsAvailable?: boolean;
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
 *   2. Evermind-first — only when the CALLER HAS NO TOOLS (the SSM cannot call any, so
 *      it must not pre-empt a run that could fetch the real answer), the project opted
 *      in (`inferenceEnabled`, version ≥ 1), AND the SSM returns a substantive reply.
 *      Exactly ONE head is consulted: this project's own, or the container's when this
 *      project is an IDE build with none of its own. A sibling build's Evermind never
 *      answers for it.
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

  // 2) Evermind-first (opt-in), from the chat's OWN head only.
  //
  // This deliberately does NOT fan out over `resolveEvermindTargets`. That resolver
  // returns the project PLUS the storage projects of every IDE build grouped under it —
  // the right set for a LEARNING fan-out (a run's lessons belong to the whole group),
  // but the wrong one for ANSWERING: it let a chat bound to project A be answered by
  // sibling build B's head, including while A's own head reported inference OFF. That
  // reads as a flat contradiction in the diagnostics ("why did an Evermind answer when
  // mine is off?") and silently attributes B's knowledge to A.
  //
  // The one head consulted is the EFFECTIVE head — the project's own, or the container's
  // when this project is an IDE build that deliberately has none of its own (the same
  // read-inheritance the console and head endpoint use). Siblings are never consulted.
  //
  // Barred outright when the caller has tools: the SSM cannot call one, so answering
  // from it would strand a request whose answer lives behind a tool call. Defaults to
  // barred when the caller says nothing (see `toolsAvailable`).
  if (deps.runEvermind && deps.toolsAvailable === false) {
    const ownerId = await resolveEffectiveEvermindProjectId(env, db, tenantId, projectId).catch(() => projectId);
    const head = await getProjectEvermindHead(env, db, tenantId, ownerId).catch(() => null);
    if (head?.inferenceEnabled && head.version >= 1 && head.ref) {
      const text = await deps.runEvermind(head.ref, q).catch(() => null);
      // Adopt only a SUBSTANTIVE and COHERENT reply. An under-trained head emits
      // fluent-looking gibberish that clears the length bar; the coherence gate
      // rejects it so we fall through to the LLM (a garbled reply IS a miss) rather
      // than answering the user in garbage. The question is passed as context so a
      // jargon-dense but legitimate answer isn't mis-accused.
      const coherent = isServableText(text, { context: q }).coherent;
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
  if (!q || !isServableText(a, { context: q }).coherent || !Number.isInteger(projectId) || projectId <= 0) return;
  await upsertProjectFact(env, db, tenantId, projectId, qaCacheKey(q), a, QA_CACHE_SOURCE).catch(() => {
    /* best-effort — caching never breaks a reply */
  });
}
