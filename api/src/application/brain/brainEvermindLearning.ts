/**
 * brainEvermindLearning — make a project-scoped Brain conversation TRAIN the
 * project's Evermind, not just agent runs.
 *
 * Historically only agent task runs fed the Evermind learning loop; a planning
 * chat in the Brain trained nothing, which is why users saw "no indication the
 * Evermind learned from the conversation". This closes that: whenever an assistant
 * turn is persisted to a project chat AND that project's Evermind is seeded +
 * connected (the same "Learn from every run" switch that gates agent runs), the
 * turn is contributed to the coordinator — the preceding user message as the task
 * prompt, the assistant turn as the exemplar, so a pinned frontier teacher distils
 * task→ideal answer exactly as it does for a run. Best-effort + fire-and-forget:
 * a frozen / unseeded / global (non-project) chat contributes nothing, and any
 * failure never touches the chat write.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { brainChats, brainChatMessages } from '../../infrastructure/database/schema';
import { getProjectEvermindHead, dispatchProjectEvermindLearnText } from '../llm/projectEvermind';

/** A one-line assistant turn is not a teaching signal; require some substance. */
const MIN_TEACH_CHARS = 40;

interface TurnMessage { role: string; content: string }

/**
 * Why a turn was NOT contributed — a machine key the client maps to a localized,
 * muted "Evermind did not learn this turn" step so the negative case is EXPLAINED,
 * never silent. `null` when the turn WAS contributed (`learned: true`).
 *   - `not-attached` — the chat isn't bound to a project (the #1 real cause: a global
 *      Brain chat, or one created before a project was selected). Only a project chat
 *      feeds a project Evermind.
 *   - `not-seeded`   — the project has no base Evermind yet (version 0).
 *   - `frozen`       — the project's Evermind is offline-frozen (read-only), so runs
 *      and replies don't contribute.
 *   - `too-short`    — no assistant turn long enough to be a teaching signal.
 */
export type BrainLearnSkipReason = 'not-attached' | 'not-seeded' | 'frozen' | 'too-short';

/**
 * Truthful outcome of the learn gate for a persisted turn — surfaced to the client
 * (send-messages response) so the Brain run loop renders a `learn` step exactly when
 * the server DID contribute, and an EXPLAINED skip step (with {@link reason}) when it
 * did not — instead of guessing from the client's pre-turn recall or, worse, showing
 * nothing at all (the silent non-learning that made "why isn't it learning?" unanswerable).
 */
export interface BrainLearnOutcome {
  learned: boolean;
  version: number;
  /** Why it did not contribute; null/absent when `learned` is true. */
  reason?: BrainLearnSkipReason | null;
}

/** The gate outcome PLUS the resolved contribution inputs, so the dispatch step can
 *  reuse them without re-reading (the gate is computed once, in the route handler). */
export interface BrainLearnGate {
  outcome: BrainLearnOutcome;
  projectId: number | null;
  /** The teachable assistant turn's content (≥ {@link MIN_TEACH_CHARS}), else null. */
  assistant: string | null;
}

/**
 * Evaluate the learn gate for the newest teachable assistant turn in `inserted`:
 * project-scoped chat + seeded, connected Evermind head (the same "Learn from every
 * run" switch that gates agent runs). Cheap enough to AWAIT before responding — the
 * head read is served through the project-Evermind read-through cache. Does NOT
 * dispatch (the slow coordinator contribution runs in {@link dispatchBrainLearn}).
 */
export async function evaluateBrainLearnGate(
  env: Env,
  db: Db,
  chatId: number,
  tenantId: number,
  inserted: ReadonlyArray<TurnMessage>,
): Promise<BrainLearnGate> {
  const assistant = [...inserted].reverse().find(
    (m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length >= MIN_TEACH_CHARS,
  )?.content ?? null;
  if (!assistant) return { outcome: { learned: false, version: 0, reason: 'too-short' }, projectId: null, assistant: null };

  const [chat] = await db
    .select({ projectId: brainChats.projectId })
    .from(brainChats)
    .where(eq(brainChats.id, chatId))
    .limit(1);
  const projectId = chat?.projectId ?? null;
  // Only a project chat feeds a project Evermind. This is the most common real reason a
  // turn "should learn" but doesn't: the "Learning — Connected" panel reflects the
  // SELECTED project's head, not whether THIS chat is attached to it.
  if (projectId == null) return { outcome: { learned: false, version: 0, reason: 'not-attached' }, projectId: null, assistant };

  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  if (head.version < 1) return { outcome: { learned: false, version: head.version, reason: 'not-seeded' }, projectId, assistant };
  if (head.mode !== 'connected') return { outcome: { learned: false, version: head.version, reason: 'frozen' }, projectId, assistant };
  return { outcome: { learned: true, version: head.version, reason: null }, projectId, assistant };
}

/**
 * Dispatch the actual contribution to the project's Evermind coordinator (the slow
 * call — run in `waitUntil`). No-ops unless the pre-computed `gate` says it will
 * contribute. Resolves the task prompt = the user message this turn answered (from the
 * batch first, else the chat's most recent user message).
 */
export async function dispatchBrainLearn(
  env: Env,
  db: Db,
  chatId: number,
  tenantId: number,
  inserted: ReadonlyArray<TurnMessage>,
  gate: BrainLearnGate,
): Promise<void> {
  if (!gate.outcome.learned || gate.projectId == null || !gate.assistant) return;

  let prompt = [...inserted].reverse().find(
    (m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0,
  )?.content ?? null;
  if (!prompt) {
    const [lastUser] = await db
      .select({ content: brainChatMessages.content })
      .from(brainChatMessages)
      .where(and(eq(brainChatMessages.chatId, chatId), eq(brainChatMessages.role, 'user')))
      .orderBy(desc(brainChatMessages.seq))
      .limit(1);
    prompt = lastUser?.content ?? null;
  }

  await dispatchProjectEvermindLearnText(env, tenantId, gate.projectId, gate.assistant, undefined, prompt);
}
