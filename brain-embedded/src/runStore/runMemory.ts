/**
 * What project MEMORY does for one run — the Evermind recall before the first turn, the
 * memory-first answer that can skip the model entirely, and the learn / reconcile
 * provenance (plus the answer-cache write) after a reply settles.
 */

import { formatEvermindMemoryBlock, countReconciledMemories, type EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import type { BrainMessage } from '../types';
import type { BrainToolSpec, ChatCompletionMessage } from '../streamChatCompletion';
import type { EvermindRunHooks, MemoryFirstAnswer } from '../evermindMemory';
import { transcriptTokens } from '@seanhogg/builderforce-memory/working';
import type { RunCell } from './runCell';
import { nowIso, pushTrace, runTrace } from './runCells';
import { readFileAnchors } from './answerAnchors';
import { latestUserText } from './convoText';
import type { BrainRunRequest } from './runTypes';
import type { RunLoopContext } from './runLoopContext';
import { adoptAnswerWithoutModel } from './adoptAnswer';

/** The pre-turn recall, the memory block it adds to the prompt, and that block's cost. */
export interface RunRecall {
  recalled: EvermindRecallResult | null;
  /** The memory block for this run's prompt (after the history under `b1_stable_prefix`,
   *  else in the system prompt — see `runPreamble`), or null when nothing was recalled. */
  block: string | null;
  /** The prompt tokens the block adds to EVERY call of this run — the cost side of
   *  recall, sent with each call beside what compaction saved it. */
  blockTokens: number;
}

/** The most hint text a recall query carries — the search is a query, not a document. */
export const MAX_RECALL_HINT_CHARS = 600;

/**
 * The recall query: the user's request, plus the host's hint (focus-file paths and their
 * top headings, PRD 35 E2) when there is one. No request ⇒ the request as it is — a hint
 * alone is not a question. Pure.
 */
export function recallQuery(userText: string, hint?: string | null): string {
  const extra = (hint ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_RECALL_HINT_CHARS);
  if (!extra || !userText.trim()) return userText;
  return `${userText.trim()}\n\n${extra}`;
}

/**
 * Evermind recall — before the FIRST turn, ask the project's self-learning model
 * which learned memories are relevant to this request. When it returns some, we
 * (a) record a visible `recall` step and (b) hand back the block the caller injects
 * into the prompt so the recall actually GROUNDS the answer (not just a UI
 * badge). Best-effort: a non-project chat / unavailable recall / thrown fetch just
 * skips it.
 */
export async function recallForRun(
  c: RunCell,
  convo: ChatCompletionMessage[],
  evermind: EvermindRunHooks | undefined,
  hint?: string,
): Promise<RunRecall> {
  let recalled: EvermindRecallResult | null = null;
  if (!evermind?.recall) return { recalled, block: null, blockTokens: 0 };
  const query = recallQuery(latestUserText(convo), hint);
  if (!query) return { recalled, block: null, blockTokens: 0 };
  try {
    recalled = await evermind.recall(query);
  } catch {
    recalled = null;
  }
  if (recalled?.seeded && recalled.items.length > 0) {
    const block = formatEvermindMemoryBlock(recalled.items);
    if (block) {
      const blockTokens = transcriptTokens([{ role: 'system', content: block }]);
      pushTrace(c, {
        ts: nowIso(),
        category: 'recall',
        label: 'evermind.recall',
        args: { query, version: recalled.version },
        result: {
          count: recalled.items.length,
          version: recalled.version,
          mode: recalled.mode,
          blockTokens,
          items: recalled.items,
        },
      });
      return { recalled, block, blockTokens };
    }
  }
  return { recalled, block: null, blockTokens: 0 };
}

/**
 * Memory-first short-circuit: if the project's OWN memory can answer this request —
 * an exact-repeat Q&A cache hit, or its Evermind SSM (opt-in) — adopt that answer and
 * SKIP the paid model entirely. This is the token-reduction core: for a repeated or
 * learned question we spend zero model tokens. Opt-in + best-effort — a host that
 * doesn't inject `answer`, a non-project chat, or a miss falls straight through to the
 * normal loop. Only attempted on the run's FIRST turn (no tool results yet).
 *
 * `toolsAvailable` is passed through HONESTLY (it is what this run can actually
 * call) because it decides how far memory is allowed to pre-empt the model: with
 * tools in play the server may only replay a cached answer, never generate a fresh
 * one from the Evermind SSM — the SSM cannot call a tool, so letting it answer
 * stranded any request whose answer lives behind one.
 *
 * The PreFetch gate's DETERMINISTIC answers (`prefetchGate.ts`, e.g. "where is X
 * defined?" from the symbol index) are asked first, by the preamble, outside the memory
 * gates — this runs only when the gate did not settle the turn.
 *
 * Returns true when memory answered — the run is over.
 */
export async function answerFromMemory(
  chatId: number,
  c: RunCell,
  req: BrainRunRequest,
  allTools: BrainToolSpec[] | undefined,
  memoryReplay: boolean,
): Promise<boolean> {
  const { evermind, model } = req;
  const convo = c.transcript;
  if (!(evermind?.answer && memoryReplay && !c.abort?.signal.aborted)) return false;
  const query = latestUserText(convo);
  if (!query) return false;
  let memAnswer: MemoryFirstAnswer | null = null;
  try {
    memAnswer = await evermind.answer(query, {
      toolsAvailable: !!allTools && allTools.length > 0,
      // What this turn would have run on — the saving a hit records is priced at it.
      model: model || c.lastServedModel || undefined,
    });
  } catch { memAnswer = null; }
  if (!memAnswer) return false;
  // Visible on the timeline: memory answered, the LLM was skipped.
  return adoptAnswerWithoutModel(chatId, c, req, memAnswer.text ?? '', {
    label: memAnswer.source === 'evermind' ? 'evermind.answer' : 'memory.answer',
    args: { query },
    result: {
      source: memAnswer.source,
      ...(memAnswer.evermindVersion != null ? { version: memAnswer.evermindVersion } : {}),
      // WHICH head served it — a project can target several, so without this a
      // memory hit from a sibling IDE build's Evermind is indistinguishable from
      // the chat project's own.
      ...(memAnswer.evermindProjectId != null ? { evermindProjectId: memAnswer.evermindProjectId } : {}),
    },
  });
}

/**
 * Evermind learning + reconciliation provenance for a completed turn. Shared so EVERY
 * way a run settles — the normal final answer, a terminal `ask_user` question, and the
 * breaker-stopped forced-final synthesis — emits identical memory provenance: a
 * forced-final answer still persists server-side (its `assistantMsg` carries the
 * truthful `evermindLearn`), so it must show the same `learn`/`reconcile` steps +
 * answer-cache write as any other. The server reports the TRUTHFUL learn outcome on the
 * persisted assistant message (`evermindLearn`) — the same `learnFromBrainTurn` gate it
 * actually applies — so the `learn` step shows exactly when the server contributed. The
 * `reconcile` step stays client-side: which of the RECALLED memories this answer
 * restated (write-through).
 */
export function emitEvermindLearnReconcile(run: RunLoopContext, assistantMsg: BrainMessage | undefined, finalText: string): void {
  const { c, recalled } = run;
  const evermind = run.req.evermind;
  const learn = assistantMsg?.evermindLearn;
  if (learn?.learned) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'learn',
      label: 'evermind.learn',
      // `targets` carries the per-Evermind breakdown (a project can fan out to many)
      // so the timeline can name each by id; the renderer falls back to `version` alone.
      result: { version: learn.version, queued: true, ...(learn.targets ? { targets: learn.targets } : {}) },
    });
    const reconciled = recalled?.items ? countReconciledMemories(recalled.items, finalText) : 0;
    if (reconciled > 0) {
      pushTrace(c, {
        ts: nowIso(),
        category: 'reconcile',
        label: 'evermind.reconcile',
        result: { count: reconciled, version: learn.version },
      });
    }
  } else if (learn && learn.reason && learn.reason !== 'too-short') {
    // The turn did NOT feed the Evermind, for a project-level reason the user can act
    // on (chat not attached to a project / not seeded / frozen). Surface it as an
    // EXPLAINED muted step so "Connected, yet nothing learned" is never a silent
    // mystery again. `too-short` is mundane (a one-line turn) and intentionally not surfaced.
    pushTrace(c, {
      ts: nowIso(),
      category: 'learn',
      label: 'evermind.learn',
      result: { version: learn.version, skipped: true, reason: learn.reason, ...(learn.targets ? { targets: learn.targets } : {}) },
    });
  }

  // Remember this (question → answer) so an exact repeat short-circuits next time
  // (see the memory-first answer at loop start) — the write half of the cache. Only
  // caches genuine model answers; the server guards length + skips trivial ones.
  // Best-effort, fire-and-forget — never delays or fails the reply.
  if (evermind?.cacheAnswer && run.memoryReplay) {
    // The user's OWN request, captured before the loop — never "the latest user
    // message", which by now may be a recovery nudge the loop wrote or carry this run's
    // per-turn context block (`turnContext`). The cache is keyed on these words.
    const q = run.userRequest;
    // With what producing it cost, so every later replay is priced from a recorded figure.
    const spent = c.runUsage;
    const origin = spent.model && spent.promptTokens + spent.completionTokens > 0
      ? { model: spent.model, promptTokens: spent.promptTokens, completionTokens: spent.completionTokens }
      : undefined;
    if (q) {
      // The files this run read — the server drops the cached answer when one changes.
      const anchors = readFileAnchors(runTrace(c));
      // No origin/anchors ⇒ the two-argument call every pre-cost hook implements.
      const cached = anchors.length
        ? evermind.cacheAnswer(q, finalText, origin, anchors)
        : origin ? evermind.cacheAnswer(q, finalText, origin) : evermind.cacheAnswer(q, finalText);
      void Promise.resolve(cached).catch(() => { /* best-effort */ });
    }
  }
}
