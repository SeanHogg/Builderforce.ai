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
 * Truthful outcome of the learn gate for a persisted turn — surfaced to the client
 * (send-messages response) so the Brain run loop renders a `learn` step exactly when
 * the server DID contribute, instead of guessing from the client's pre-turn recall.
 */
export interface BrainLearnOutcome {
  learned: boolean;
  version: number;
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
  if (!assistant) return { outcome: { learned: false, version: 0 }, projectId: null, assistant: null };

  const [chat] = await db
    .select({ projectId: brainChats.projectId })
    .from(brainChats)
    .where(eq(brainChats.id, chatId))
    .limit(1);
  const projectId = chat?.projectId ?? null;
  if (projectId == null) return { outcome: { learned: false, version: 0 }, projectId: null, assistant }; // only a project chat feeds a project Evermind

  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  const learned = head.version >= 1 && head.mode === 'connected'; // seeded + connected → will contribute
  return { outcome: { learned, version: head.version }, projectId, assistant };
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
