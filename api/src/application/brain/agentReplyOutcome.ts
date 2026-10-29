/**
 * What happens AFTER the addressed-agent reply's model loop — the optional Evermind
 * regeneration of the final prose, the actionable empty-reply diagnostic, and the
 * persist + audit + learn of a successful reply. Split out of
 * `BrainService.agentReply` (now `agentReply.ts`).
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { readProxyChoice, type LlmProxyService } from '../llm/LlmProxyService';
import { classifyReplyAccount, buildReplyProvenance, vendorAccountLabel } from '../llm/replyProvenance';
import { recordActivity, cloudAgentActor, buildModelActivityMetadata } from '../activity/activityLog';
import { getProjectEvermindHead, recordEvermindServeOutcome } from '../llm/projectEvermind';
import { isServableText } from '@seanhogg/builderforce-memory/evermind';
import { learnFromPersistedTurns } from './brainEvermindLearning';
import { vendorForModel } from '../llm/vendors';
import { resolveChatMode } from './chatMode';
import { completeTraced, type BrainCallContext } from './brainLlmCall';
import { appendRaw } from './brainMessageStore';
import { readByoFunded, readModel, readVendor, type ReplyTurnState } from './agentReplyState';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * Run this reply ON the project's Evermind (opt-in inference).
 *
 * When the project opted into running on its own self-learning model, regenerate
 * the FINAL user-facing prose on its Evermind so the learned voice/knowledge shapes
 * the answer — while the tool-loop stayed on the capable coding model (the tiny
 * SSM can't tool-call, so it never drives tool selection). SOFT pin: passing
 * `evermind/<ref>` WITHOUT modelStrict makes complete() try Evermind first and CASCADE
 * to the coding pool on error; we ADOPT the Evermind turn only when Evermind ITSELF
 * served a substantive AND coherent reply (resolved model still `evermind/`, ≥20 chars,
 * passes `looksLikeCoherentText`) — otherwise we keep the capable-model answer. So an
 * under-trained head can never make the agent reply in gibberish, enabling inference can
 * never break or blank a reply, and a successful turn carries the "🧠 Evermind vN" chip.
 * [[evermind-learning-architecture]]
 *
 * Mutates `s` (text / model / vendor / funding) only when the Evermind turn is adopted.
 */
export async function regenerateOnEvermind(args: {
  db: Db;
  env: Env;
  tenantId: number;
  projectHint: number | null;
  service: LlmProxyService;
  convo: Array<Record<string, unknown>>;
  agentName: string;
  replyTemp: number;
  transcript: string;
  call: BrainCallContext;
  s: ReplyTurnState;
}): Promise<{ version: number } | undefined> {
  const { db, env, tenantId, projectHint, service, convo, agentName, replyTemp, transcript, call, s } = args;
  let evermindRun: { version: number } | undefined;
  if (s.text && projectHint != null) {
    const head = await getProjectEvermindHead(env, db, tenantId, projectHint).catch(() => null);
    if (head?.inferenceEnabled && head.version >= 1 && head.ref) {
      const evResult = await completeTraced(db, service, {
        model: `evermind/${head.ref}`,
        messages: [...convo, { role: 'user', content: `Write your reply to the team AS ${agentName}: plain prose, first person, no tool calls. Summarise what you found or did.` }] as never,
        temperature: replyTemp,
        max_tokens: 1000,
      } as never, call);
      const evModel = readModel(evResult);
      const evChoice = await readProxyChoice(evResult);
      // Adopt the Evermind turn ONLY when it served a substantive AND coherent reply
      // (same bar the memory-first resolver uses — DRY). An under-trained head emits
      // gibberish that clears the length check; keep the capable-model answer instead.
      const evRan = evModel.startsWith('evermind/'); // false if it cascaded to a real model
      // The transcript is passed as context so domain jargon the conversation already
      // uses is never mistaken for the invented-word gibberish the gate hunts for.
      const evCoherent = evRan && isServableText(evChoice.content, { context: transcript }).coherent;
      // Feed the outcome to the head's quarantine counter (only when Evermind ITSELF
      // ran — a cascade-away isn't the SSM's output). N incoherent serves in a row
      // auto-disable inference so a broken head stops answering in gibberish.
      if (evRan) {
        await recordEvermindServeOutcome(env, db, tenantId, projectHint, evCoherent).catch((error) => { /* best-effort */
          reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "agentReply" });
        });
      }
      if (evCoherent) {
        s.text = evChoice.content;
        s.lastModel = evModel;
        s.lastVendor = readVendor(evResult) || s.lastVendor;
        s.lastByoFunded = readByoFunded(evResult);
        evermindRun = { version: head.version };
      }
    }
  }
  return evermindRun;
}

/**
 * Actionable diagnostics beat a bare "empty reply": name the account the run
 * used, the model it resolved to, and how much tool work happened — so the user
 * can tell a transient empty turn from a misconfigured agent/account.
 */
export function emptyReplyError(s: ReplyTurnState, agentName: string, hasConnectedAccount: boolean) {
  const { lastByoFunded, lastVendor, lastModel, toolCallCount, iterations, lastFinish } = s;
  // Name the account HONESTLY from the SAME authoritative signal the provenance
  // chip uses (`byoFunded` — did the tenant's own credential serve the call), not
  // a connected-token-is-present guess: a cascade or base-model pin can land on the
  // shared pool even with a connection. `classifyReplyAccount` is the one place that
  // decision lives, shared with the streaming gateway header.
  const account = classifyReplyAccount(lastByoFunded, hasConnectedAccount);
  const via = account === 'own'
    ? `your connected ${vendorAccountLabel(lastVendor || (lastModel ? vendorForModel(lastModel) : ''))} account`
    : account === 'shared_byo_unused'
      ? 'the shared model pool (your connected account was NOT used for this run)'
      : 'the shared model pool';
  const modelNote = lastModel ? ` (model: ${lastModel})` : '';
  const toolNote = toolCallCount
    ? ` after ${toolCallCount} tool call${toolCallCount === 1 ? '' : 's'} over ${iterations} step${iterations === 1 ? '' : 's'}`
    : '';
  // Surface the model's finish_reason so a genuinely-empty completion is self-describing:
  // `length` ⇒ the token budget was exhausted (e.g. a reasoning model spent it thinking);
  // `stop`/`end_turn` ⇒ the model chose to say nothing. Distinguishes a config/prompt
  // problem from a transient blank.
  const finishNote = lastFinish && lastFinish !== 'stop' ? ` (finish_reason: ${lastFinish})` : '';
  // If a connected account was TRIED and failed (so the cascade moved on), say so
  // with its status — an expired/revoked subscription 401s, a bad request 400s. This
  // turns a mystifying "empty reply" into a fix ("reconnect your Claude account").
  // `byoFailure` is null when the connected account served fine (or none exists).
  const bf = s.byoFailure;
  // `code: 0` means the vendor `fetch()` threw before any HTTP response — the status
  // alone ("no response") hides the cause, so surface the thrown detail (e.g.
  // `network: <cause>`) which is the ONLY thing that distinguishes a transport/request
  // failure from an auth rejection. Auth statuses keep their reconnect hint.
  const bfCause = bf
    ? bf.code === 401 || bf.code === 403
      ? ` — the token looks expired or revoked; reconnect it in Settings ▸ API Keys`
      : bf.code === 0 && bf.detail
        ? ` — ${bf.detail}`
        : ''
    : '';
  // Where the run went AFTER that failure, read off the SAME classification that
  // produced `via` — not assumed. A tenant with several connected accounts cascades
  // from the failed one onto ANOTHER OF THEIR OWN, and this sentence used to assert
  // "fell back to the shared pool" unconditionally: the shipped ticket read
  // "ran on your connected provider account … so the run fell back to the shared
  // pool", two contradictory claims about the same turn in the same sentence.
  const fellBackTo = account === 'own'
    ? 'so the run moved to another of your connected accounts'
    : 'so the run fell back to the shared pool';
  const byoNote = bf
    ? ` Your connected ${vendorAccountLabel(bf.vendor)} account was tried first but errored (${bf.code || 'no response'})${bfCause}, ${fellBackTo}.`
    : '';
  return {
    error: `${agentName} ran on ${via}${modelNote} but produced no reply${toolNote}${finishNote}.${byoNote} The model returned an empty turn — this usually clears on a retry. If it persists, set a stronger base model for this agent in Workforce, or confirm your connected account is active.` as const,
  };
}

/** Post the reply (attributed + provenance), write the audit row, feed Evermind. */
export async function persistAgentReply(args: {
  db: Db;
  env: Env;
  chatId: number;
  tenantId: number;
  chat: unknown;
  projectHint: number | null;
  agentRef: string;
  agentName: string;
  executionCtx?: ExecutionContext;
  s: ReplyTurnState;
  hasConnectedAccount: boolean;
  evermindRun: { version: number } | undefined;
}) {
  const { db, env, chatId, tenantId, chat, projectHint, agentRef, agentName, s, hasConnectedAccount, evermindRun } = args;
  const text = s.text;
  // Attribute the turn to the agent AND record its provenance — the resolved model
  // + whether the tenant's OWN connected account served it — so a SUCCESSFUL reply
  // shows the same "whose account ran this" chip that a streaming Brain turn does,
  // not only the empty-reply diagnostic. `provenance` is the wire key brain-ui's
  // parseMessageProvenance reads.
  const provenance = buildReplyProvenance({
    model: s.lastModel,
    vendor: s.lastVendor || undefined,
    byoFunded: s.lastByoFunded,
    hasConnectedAccount,
    evermind: evermindRun,
  });
  const metadata = JSON.stringify({
    authoredBy: { kind: 'agent', ref: agentRef, name: agentName },
    provenance,
  });
  const [posted] = await appendRaw(db, chatId, [{ role: 'assistant', content: text, metadata }]);

  // (The reply's steps were persisted earlier, on BOTH the reply and no-reply paths.)

  // Audit: an agent ACTED in this chat, and on WHICH MODEL. Previously a chat turn
  // wrote no activity row at all, so the audit timeline could not answer "what model
  // did this agent run on" — the provenance existed only on the chat message. Same
  // `provenance` object, projected through the ONE shared metadata builder the gateway
  // default-agent turn also uses. Best-effort by design (recordActivity swallows) —
  // `llm_usage_log` remains the billing source of truth.
  await recordActivity(env, db, {
    tenantId,
    projectId: projectHint,
    actor: cloudAgentActor(agentRef, agentName),
    verb: 'agent.replied',
    targetType: 'chat',
    targetId: chatId,
    targetLabel: (chat as unknown as { title?: string | null }).title ?? null,
    summary: `${agentName} replied in chat #${chatId}${provenance.model ? ` using ${provenance.model}` : ''}`,
    metadata: buildModelActivityMetadata({
      via: 'brain-chat',
      model: provenance.model,
      vendor: provenance.vendor,
      account: provenance.account,
      byoFunded: s.lastByoFunded,
      evermind: provenance.evermind,
      // `mode` is what makes this row readable as execution-vs-conversation after
      // the fact: without it every agent turn looks alike and the mode rollup can
      // only count chats, never what happened inside them.
      extra: { chatId, mode: resolveChatMode(chat as { origin?: string | null; mode?: string | null }) },
    }),
  });

  // Contribute this @agent reply to the project's Evermind through the SAME
  // learn-on-persist path the Brain message route uses. Previously the addressed-reply
  // loop persisted via appendRaw DIRECTLY and silently skipped training, so @agent
  // turns never fed the project Evermind (GAP-488). Best-effort; dispatched in the
  // background via the route's executionCtx when present.
  await learnFromPersistedTurns(
    env, db, chatId, tenantId, [{ role: 'assistant', content: text }],
    (p) => { if (args.executionCtx) args.executionCtx.waitUntil(p); },
  ).catch((error) => { /* never fail the reply */
    reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "agentReply" });
  });

  return posted ?? { error: 'Failed to post reply' as const };
}
