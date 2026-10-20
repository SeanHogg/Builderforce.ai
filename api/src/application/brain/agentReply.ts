/**
 * Addressed-agent reply — a chat-scoped run that answers AS an invited agent.
 * Split out of `BrainService.ts` (whose `agentReply` delegates here).
 *
 * Produce a reply AS an invited agent participant and post it as an assistant
 * turn attributed to that agent (metadata `authoredBy: {kind:'agent', ref, name}`,
 * mirroring the `addressedTo` convention). This is the "next layer" over directed
 * messages: `@agent`-ing a participant used to only post the user's turn; now the
 * addressed agent actually answers, grounded on its own persona + ingested
 * knowledge (via the shared {@link resolveWorkforceModel}) and on the transcript.
 *
 * The agent runs a BOUNDED server-side tool loop over the curated, non-destructive
 * platform tools (`CLOUD_AGENT_PLATFORM_TOOLS` — projects/tasks/specs/OKRs/knowledge
 * reads + safe writes, NO deletes or control-plane) PLUS the chat-scoped read/link
 * tools (`CHAT_SCOPED_AGENT_TOOLS` — list/link/unlink tickets on THIS chat, the current
 * chatId injected into the system prompt), executed via `callBuiltinTool`
 * with the TRIGGERING USER's role/token so the agent can never exceed the human's
 * own permissions. So a teammate agent can actually DO things (create a follow-up
 * task, update an OKR, read the board) when addressed — not just chat. Tool errors
 * are fed back as tool results so the agent can recover or explain. File-editing is
 * still the BRAIN/host loop's job; this is the platform-tool layer.
 *
 *   agentReplyPrompt  — toolset + system prompt
 *   agentReplyLoop    — the model/tool loop + forced synthesis
 *   agentReplyOutcome — Evermind regeneration, empty-reply diagnostic, persist
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { eq, ne, and, desc } from 'drizzle-orm';
import { brainChats, brainChatMessages } from '../../infrastructure/database/schema';
import { readTimelineTail } from '../../domain/shared/timelineTail';
import { explicitModelPreemptsByo } from '../llm/LlmProxyService';
import { loadCanvasBoardGrounding } from '../creation/canvasBoardGrounding';
import { tenantProxyForPlan } from '../llm/tenantProxy';
import { resolveWorkforceModel, WORKFORCE_MODEL_REF_PREFIX } from '../agent/agentPrompt';
import { stepRow } from '@builderforce/agent-loop';
import { MANAGER_ORIGIN } from './chatAccess';
import { resolveChatMode } from './chatMode';
import { messageColumns } from './brainChatShapes';
import { canAccessChat } from './brainChatGuards';
import { ADVISORY_THREAD_AI_CONTEXT_ERROR, advisoryChatAdmittedToAiContext } from '../commerce/advisoryReservation';
import { appendRaw } from './brainMessageStore';
import type { BrainCallContext } from './brainLlmCall';
import { agentReplySystemPrompt, agentReplyToolset } from './agentReplyPrompt';
import { runAgentReplyLoop } from './agentReplyLoop';
import { emptyReplyError, persistAgentReply, regenerateOnEvermind } from './agentReplyOutcome';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** The assistant turn this agent already posted after the latest user message, if any. */
function alreadyRepliedAsAgent<T extends { role: string; metadata?: string | null }>(
  msgs: readonly T[],
  agentRef: string,
): T | undefined {
  let lastUserIdx = -1;
  for (let i = 0; i < msgs.length; i++) if (msgs[i]!.role === 'user') lastUserIdx = i;
  if (lastUserIdx < 0) return undefined;
  for (let i = lastUserIdx + 1; i < msgs.length; i++) {
    const m = msgs[i]!;
    if (m.role !== 'assistant' || !m.metadata) continue;
    try {
      const authored = (JSON.parse(m.metadata) as { authoredBy?: { kind?: string; ref?: unknown } }).authoredBy;
      if (authored?.kind === 'agent' && String(authored.ref) === String(agentRef)) return m;
    } catch (error) { /* not an attributed turn */
      reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "alreadyRepliedAsAgent" });
    }
  }
  return undefined;
}

export async function agentReply(
  db: Db,
  chatId: number,
  tenantId: number,
  userId: string,
  input: { agentRef: string; agentName?: string },
  env: Env,
  opts?: { role?: string; authToken?: string | null; executionCtx?: ExecutionContext },
) {
  // `origin` is read alongside the access check because the MANAGER chat (0376) asks a
  // different KIND of question than a team chat does — see `accountabilityFraming`.
  // `mode` (0409) decides whether this reply may turn its conclusions into dispatched
  // work or must stop at answering; both are resolved together by `resolveChatMode`.
  const chat = await canAccessChat(db, chatId, tenantId, userId, {
    projectId: brainChats.projectId,
    origin: brainChats.origin,
    mode: brainChats.mode,
  });
  if (!chat) return { error: 'Chat not found' as const };
  if (!await advisoryChatAdmittedToAiContext(db, chatId, env)) {
    return { error: ADVISORY_THREAD_AI_CONTEXT_ERROR };
  }
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return { error: 'LLM not configured' as const };

  // Conversation turns only: the `role:'tool'` step rows (this reply's own, and every
  // client run's) are timeline evidence, not transcript — left in, they would eat the
  // 80-row window and render as empty lines in the prompt.
  const msgs = await readTimelineTail(
    (rows) => db
      .select(messageColumns)
      .from(brainChatMessages)
      .where(and(eq(brainChatMessages.chatId, chatId), ne(brainChatMessages.role, 'tool')))
      .orderBy(desc(brainChatMessages.seq))
      .limit(rows),
    80,
    80,
  );
  if (msgs.length === 0) return { error: 'Nothing to reply to' as const };
  // Client fan-out AND sendMessages waitUntil can both call this for the same
  // turn; return the already-posted reply instead of running the LLM twice.
  const already = alreadyRepliedAsAgent(msgs, input.agentRef);
  if (already) return already;

  // Persona + own-knowledge grounding for a workforce agent (ref = ide_agents.id).
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
  const resolved = await resolveWorkforceModel(env, tenantId, WORKFORCE_MODEL_REF_PREFIX + input.agentRef, lastUser).catch(() => null);
  const agentName = input.agentName?.trim() || 'the agent';
  const persona = resolved?.directives
    ? `${resolved.directives}\n\n`
    : `You are ${agentName}, a member of this team's chat.\n\n`;
  // The persona's compiled directives are already folded into `resolved.directives`
  // (→ the system prompt), and its compiled temperature drives sampling here — so the
  // agent replies UNDER its personality, tone AND sampling, instead of a flat default.
  // Falls back to the prior 0.4 when the agent carries no psychometric profile.
  const replyTemp = resolved?.execParams?.temperature ?? 0.4;

  const authorName = (label: string | null): string => {
    if (!label) return 'BuilderForce';
    try {
      const a = (JSON.parse(label) as { authoredBy?: { name?: string } }).authoredBy;
      return a?.name || 'BuilderForce';
    } catch { return 'BuilderForce'; }
  };
  const transcript = msgs
    .map((m) => `${m.role === 'user' ? 'User' : authorName(m.metadata)}: ${m.content}`)
    .join('\n\n');
  // A canvas group turn tags its message with the board it was asked on; the agent
  // answers from THAT board rather than from the project alone (see
  // `loadCanvasBoardGrounding`). A board that cannot be read degrades to no digest.
  const lastUserMetadata = [...msgs].reverse().find((m) => m.role === 'user')?.metadata ?? null;
  const boardGrounding = await loadCanvasBoardGrounding(db, env, tenantId, userId, lastUserMetadata).catch(() => null);

  // The request this reply is answering — the newest USER turn, not the whole
  // transcript and not a nudge this loop injected. The stall gate needs it to tell a
  // change request (where handing the work back is a stall) from a question (where
  // naming the commands IS the answer).
  const userRequest = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';

  const projectHint = (chat as unknown as { projectId?: number | null }).projectId ?? null;
  const isManagerChat = (chat as unknown as { origin?: string | null }).origin === MANAGER_ORIGIN;
  // Conversation or execution (0409). Team + manager chats resolve to 'work' by origin
  // whatever the column says — driving work IS what those conversations are for.
  const chatMode = resolveChatMode(chat as { origin?: string | null; mode?: string | null });

  const toolset = agentReplyToolset();
  const systemPrompt = agentReplySystemPrompt({
    persona, agentName, chatId, projectHint, boardGrounding, isManagerChat, chatMode, nameFor: toolset.nameFor,
  });

  const convo: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Conversation so far:\n\n${transcript}` },
  ];

  // ONE builder: the tenant's connected frontier account (BYO Claude subscription /
  // api-key) threaded + plan resolved together, so the addressed agent runs on the
  // tenant's OWN account when they have one — NOT a weak operator-key model that
  // empty-turns. `codingOnly` restricts failover to the curated coding pool + paid
  // coding backstop (agentic tool turn), never a lite non-coder.
  const { proxy: service, byoVendors, registeredModels, plan } = await tenantProxyForPlan(env, tenantId, { codingOnly: true });
  // The tenant's connected account beats a weak/default agent base model. Honor an
  // explicit base model ONLY when it preempts the BYO seed — the tenant has no
  // connected account, OR the base model is itself served by a connected BYO vendor.
  // Otherwise leave the model unset so complete() seeds the tenant's BYO flagship
  // (Opus for this agentic turn) instead of a free operator-keyed coder (e.g. a default
  // `@cf/*` model) that returns empty turns and never touches the connected account —
  // the exact bug where a connected Claude subscription still ran Ada on `@cf/qwen/...`.
  const baseModel = resolved?.baseModel ?? undefined;
  const pinnedModel = explicitModelPreemptsByo(baseModel, byoVendors, registeredModels) ? baseModel : undefined;
  const hasConnectedAccount = byoVendors.size > 0;

  // ONE call context for every model turn this reply makes — so the tool loop, the
  // forced synthesis and the Evermind regeneration are all billed AND traced
  // identically, under the same chat/project/agent attribution.
  const call: BrainCallContext = {
    env, ...(opts?.executionCtx ? { executionCtx: opts.executionCtx } : {}),
    apiKey, tenantId, userId, useCase: 'brain_agent_reply',
    chatId, projectId: projectHint, agentRef: input.agentRef,
  };

  const s = await runAgentReplyLoop({
    db, env, tenantId, userId, agentRef: input.agentRef, agentName, opts,
    service, convo, toolset, userRequest, replyTemp, pinnedModel, byoVendors, plan, call,
  });

  const evermindRun = await regenerateOnEvermind({
    db, env, tenantId, projectHint, service, convo, agentName, replyTemp, transcript, call, s,
  });

  // Persist the steps of THIS reply — BEFORE the empty-reply branch below, not after
  // it, and before the reply itself so they sit ahead of it in seq order. Until this
  // moved, the trace was written only on the success path, so a
  // turn that produced NO reply — the exact failure the trace exists to explain — threw
  // its own evidence away and left the diagnostics report reading rows from whatever
  // older turn had last succeeded. That is how a support capture taken minutes after a
  // 400 came back describing a two-day-old, already-fixed defect. One bounded append;
  // best-effort by design — a step-write failure must never cost an answer or a diagnosis.
  if (s.trace.length > 0) {
    await appendRaw(db, chatId, s.trace.map((step) => stepRow(step))).catch((error) => {
      reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "agentReply" });
    });
  }

  if (!s.text) return emptyReplyError(s, agentName, hasConnectedAccount);

  return persistAgentReply({
    db, env, chatId, tenantId, chat, projectHint, agentRef: input.agentRef, agentName,
    ...(opts?.executionCtx ? { executionCtx: opts.executionCtx } : {}),
    s, hasConnectedAccount, evermindRun,
  });
}
