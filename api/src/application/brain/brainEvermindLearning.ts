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
 * Contribute the newest assistant turn in `inserted` to the project's Evermind.
 * No-ops unless the chat is project-scoped and its Evermind is seeded + connected.
 */
export async function learnFromBrainTurn(
  env: Env,
  db: Db,
  chatId: number,
  tenantId: number,
  inserted: ReadonlyArray<TurnMessage>,
): Promise<void> {
  const assistant = [...inserted].reverse().find(
    (m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length >= MIN_TEACH_CHARS,
  );
  if (!assistant) return;

  const [chat] = await db
    .select({ projectId: brainChats.projectId })
    .from(brainChats)
    .where(eq(brainChats.id, chatId))
    .limit(1);
  const projectId = chat?.projectId ?? null;
  if (projectId == null) return; // only a project chat feeds a project Evermind

  // Respect the project's learning switches (same gate as an agent run): the head
  // read is served through the project-Evermind read-through cache, so this is cheap.
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  if (head.version < 1 || head.mode !== 'connected') return; // unseeded or frozen → no contribution

  // Task prompt = the user message this turn answered — from the batch first, else
  // the chat's most recent user message.
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

  await dispatchProjectEvermindLearnText(env, tenantId, projectId, assistant.content, undefined, prompt);
}
