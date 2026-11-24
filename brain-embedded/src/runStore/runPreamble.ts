/**
 * Everything a run resolves ONCE, before its first turn — the catalog it advertises (`runPreambleCatalog.ts`), the recall and memory
 * answer, the system prompt with every directive folded in (`runPreambleDirectives.ts`), the read/write/failure guards, and the run
 * policy it starts from. Returns the run's shared state ({@link BrainRunContext}), or null when memory answered and the run is over.
 */

import type { RunPolicyState } from '@builderforce/run-policy';
import { deviceLeverOn } from './deviceLevers';
import { measureWorkflowSync } from '@builderforce/agent-run';
import { brainEventSink } from '../run/eventSink';
import { memoryReplayable } from '@builderforce/agent-stall';
import type { CompletionMetadata } from '../streamChatCompletion';
import { normalizeChatMode } from '../chatMode';
import { routingQueryForTurn } from '../turnOptimization';
import { createEvidenceLedger } from '@builderforce/run-guards';
import { previousReplyText } from '../restatedReply';
import { ReadCoverage } from '../readCoverage';
import { CacheServedStreak } from '@builderforce/agent-run';
import { readRequest } from './requestReading';
import { RunKnowledgeRecorder, type RunKnowledgeLog } from '@builderforce/agent-tools';
import { FailureTally, WriteLedger } from '@builderforce/run-guards';
import { PlaceholderLedger } from '../completionGuard';
import { HISTORY_TOKEN_BUDGET } from '@seanhogg/builderforce-memory/working';
import { recordTranscriptAnchors } from './runFoldMarker';
import { createRunWindowFit } from '../windowFit/runWindowFit';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';
import { seedConfigLog } from './configLog';
import { isFollowUpTurn, latestUserText } from './convoText';
import { adoptMemoryAnswer, lookupMemoryAnswer, recallForRun } from './runMemory';
import { budget, PREFLIGHT_PROBE_MS } from './deadline';
import { answerDeterministically } from './prefetchGate';
import { gatherHostRunContext, recordServedReads } from './hostRunContext';
import type { BrainRunContext } from './brainRunContext';
import type { OutcomeReport } from '../run/eventSink';
import type { BrainRunRequest } from './runTypes';
import { attachTurnContext, restoreTurnContext, turnContextBlock, turnContextCarrier } from './turnContext';
import { resolveServerChatId } from './serverChat';
import { decideRoute, routeMetadata } from './runRoute';
import { PendingCalls } from './pendingCalls';
import { conversationPinnedTools } from './conversationPins';
import { assembleOpening } from './openingSections';
import { advertisedTools, resolveCatalog } from './runPreambleCatalog';
import { foldRunDirectives } from './runPreambleDirectives';

/** B1 (`b1_stable_prefix`): per-turn blocks ride AFTER the history instead of in the
 *  system prompt (`COST_LEVER_B1_STABLE_PREFIX=off` turns it off). */
function stablePrefixOn(): boolean {
  return deviceLeverOn('b1_stable_prefix');
}

/** The run's record — the host's when it lends one — named for the request it serves. */
function recorderFor(userRequest: string, lent?: RunKnowledgeLog): RunKnowledgeLog {
  const r = lent ?? new RunKnowledgeRecorder();
  if (!r.activity.prompt) r.setPrompt(userRequest);
  return r;
}

export async function prepareBrainRun(chatId: number, c: RunCell, req: BrainRunRequest, runKey: number, reportRunRow?: OutcomeReport): Promise<BrainRunContext | null> {
  const { resolvedSystemPrompt, stream, evermind } = req;
  const convo = c.transcript;
  // The previous run's per-turn block goes back off its user message BEFORE anything
  // here reads the history (recall query, follow-up test, routing query) — see `turnContext`.
  restoreTurnContext(c);
  // Which persisted messages the transcript holds — what a fold's durable marker keeps from.
  recordTranscriptAnchors(c, req);
  // Volatile, per-run blocks: kept out of the system prompt when the lever is on, so
  // the prompt prefix is byte-identical across runs of a chat and caches.
  const stablePrefix = stablePrefixOn();
  const turnParts: string[] = [];
  // The catalog the model is shown, PLUS the conversational `ask_user` / `hand_off` tools (`runPreambleCatalog.ts`).
  const { canAskUser, allTools, catalogToolNames } = resolveCatalog(req);
  // Caller provenance for the gateway's audit emit — this is what makes the
  // DEFAULT agent's turn show WHICH MODEL served it in the activity log (the
  // server no-ops without a chat id). Built once and shared by every
  // model-facing turn of this run. Deliberately NOT passed to the transcript
  // summarizer (`summarizeMiddle`): that is mechanical compaction, not a reply,
  // and auditing it would double-count the turn.
  // Conversation or execution (0409). Resolved once here because BOTH the usage
  // metadata below and the system-prompt directive further down need it, and they must
  // never disagree about which mode this run was.
  const runMode = normalizeChatMode(req.chatMode ?? 'work');
  // The chat's config log (`configLog.ts`): seed the model + run mode in force as this run
  // begins. The settings are GLOBAL (host-level), so a later change arrives through the
  // request's `configChange` hook and is appended mid-run. A pure in-memory append onto
  // the cell's always-initialised `configLog`, so there is nothing to catch.
  seedConfigLog(c, { model: req.model, modelStrict: req.modelStrict, routingMode: req.routingMode, runMode });
  // The SERVER chat (PRD 36): on a local-first host `chatId` is a view key that never
  // leaves the machine, so an unbound chat sends no chat id at all — never its own number,
  // which named (and billed) whichever server chat happened to share it.
  const serverChatId = resolveServerChatId(chatId, req);
  // Full pipeline or a quick pass — decided ONCE, on the user's own request, before any
  // turn (see `runRoute.ts`). Every call carries the route, so the gateway's usage
  // row and the device's ledger row both say which pipeline spent the tokens.
  const route = measureWorkflowSync(brainEventSink(c), { runId: c.runId, entryPoint: req.entryPoint, step: 0 }, 'route', () => decideRoute(req, latestUserText(convo), isFollowUpTurn(convo)), (r) => ({ reusedDecision: 0, quick: Number(r.pipeline?.route === 'quick'), full: Number(r.pipeline?.route === 'full') }));
  const pipeline = route.pipeline;
  if (pipeline) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'run.pipeline_route',
      args: { route: pipeline.route, score: pipeline.score },
      result: `${pipeline.route === 'quick' ? 'Quick pass' : 'Full pipeline'}: ${pipeline.reason}`,
    });
  }
  const metadata: CompletionMetadata = {
    ...(serverChatId != null ? { chatId: serverChatId } : {}),
    ...(req.clientChatId ? { clientChatId: req.clientChatId } : {}),
    guestTurnId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    guestTurnInput: latestUserText(convo),
    mode: runMode,
    ...(req.projectId != null ? { projectId: req.projectId } : {}),
    ...routeMetadata(route),
  };

  // What the host hands the run before turn 1, in one wait (see `hostRunContext.ts`): the
  // recall hint (its context pack's focus files + headings) widens the query past the
  // bare sentence; the model preflight (E7) is on the banner before the first turn.
  const preflightStarted = Date.now();
  const remaining = budget(PREFLIGHT_PROBE_MS);
  const memoryReplay = memoryReplayable(latestUserText(convo), { followUp: isFollowUpTurn(convo) });
  const gatePending = answerDeterministically(chatId, c, req, metadata.guestTurnId, runKey);
  const memoryAnswer = gatePending.then((gate) => gate.answered || remaining() <= 1
    ? null : lookupMemoryAnswer(c, req, allTools, memoryReplay, remaining()));
  const hostAndRecall = gatherHostRunContext(c, req, !!evermind?.recall).then(async (host) => ({
    host, recall: await recallForRun(c, convo, evermind, host.recallHint, remaining()),
  }));
  const [{ host, recall }, memoryCandidate] = await Promise.all([hostAndRecall, memoryAnswer]);
  const { recalled, block: recallBlock, blockTokens: recallBlockTokens } = recall;
  if (evermind?.recall || evermind?.answer || req.modelPreflight || req.turnContext || req.servedReads) {
    pushTrace(c, {
      ts: nowIso(), category: 'message', label: 'run.preflight',
      durationMs: Date.now() - preflightStarted,
      args: { recalled: !!recallBlock, memoryAnswer: !!memoryCandidate },
    });
  }
  // The opening prompt, built ONCE from the request's data (`openingSections.ts`); everything below only appends per-run blocks.
  let systemPrompt = assembleOpening(resolvedSystemPrompt, req.opening);
  // The per-turn parts the lever folds into the system prompt instead (`stablePrefix` off): still THIS turn's text (`promptTools.turn`).
  const turnPartsInPrompt: string[] = [];
  const intoPrompt = (part: string): void => {
    systemPrompt = `${systemPrompt}\n\n${part}`;
    turnPartsInPrompt.push(part);
  };
  if (recallBlock) {
    if (stablePrefix) turnParts.push(recallBlock);
    else intoPrompt(recallBlock);
  }
  const priorRecall = { query: latestUserText(convo), result: recalled };

  // May memory stand in for this turn at all — and may this turn's answer be stored for
  // next time? Decided ONCE, here, before the transcript grows, because only this loop
  // holds the conversation: a stored reply is keyed on the question's words, so it can
  // only answer a question that means the same thing everywhere — the opening turn of a
  // conversation, not "status?" three turns in (which replayed another chat's ticket
  // report). The same gate covers every tier: on-device, the Q&A cache and Evermind.
  // The PreFetch gate first (`prefetchGate.ts`): a deterministic ANSWER ends the run here;
  // PREFETCH output joins the volatile tail below. Computed from the workspace NOW, so it
  // is not held to the memory replay gate.
  const gate = await gatePending;
  if (gate.answered) return null;
  // How the gate left the turn rides every model call it makes, so the device ledger's
  // rows (and the gateway's own) say whether the model started from prefetched facts.
  if (req.prefetch) metadata.gateRoute = gate.tail.length > 0 ? 'prefetch' : 'llm';
  if (await adoptMemoryAnswer(chatId, c, req, memoryCandidate)) return null;

  // The host's task context (its context pack, E2) is ALWAYS volatile: it changes every
  // run, so it rides after the history whatever the stable-prefix lever says. The gate's
  // PREFETCH output rides the same channel — never the system prompt, so the cached
  // prefix is untouched — and a block the pack already carries (its pre-search hits) is
  // not repeated.
  if (host.turnContext) turnParts.push(host.turnContext);
  for (const block of gate.tail) if (!host.turnContext?.includes(block)) turnParts.push(block);

  // Per-turn system-prompt augmentation (the LIMBIC parity seam). Fetched once
  // at loop start with the latest user text; a non-empty return is appended to
  // the system prompt. Best-effort — a throw just skips it, exactly like the
  // Evermind recall above.
  if (req.augmentSystemPrompt) {
    try {
      const extra = await req.augmentSystemPrompt(latestUserText(convo));
      if (typeof extra === 'string' && extra.trim()) {
        // Fetched per turn with the latest user text — volatile by construction.
        if (stablePrefix) turnParts.push(extra);
        else intoPrompt(extra);
      }
    } catch (error) {
      // The augmentation is optional, but preserve the cause on the run trace.
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'system_prompt.augmentation_failed',
        result: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The directives this surface's capabilities imply — the conversation's mode, the ship policy and publish hold, the Studio's preview
  // review and the earlier turns' tool work (`runPreambleDirectives.ts`).
  const folded = foldRunDirectives(c, convo, req, runMode, serverChatId, catalogToolNames, systemPrompt);
  systemPrompt = folded.systemPrompt;
  const { previewReview, hold } = folded;

  // What the person's request means for this run: their own words, the directives
  // they imply (a bare continuation, the chat's change asks) and the hand-off goal
  // (`requestReading.ts`). The directives ride the same channel as every other.
  const reading = readRequest(c, convo, runMode);
  const { userRequest } = reading;
  for (const directive of reading.directives) {
    if (stablePrefix) turnParts.push(directive);
    else intoPrompt(directive);
  }

  // The tools the prompt names, and the ones every turn must advertise (`runPreambleCatalog.ts`).
  const turnContext = turnContextBlock(turnParts);
  const { promptTools, alwaysAdvertised } = advertisedTools(
    { systemPrompt, turnContext, turnPartsInPrompt, userRequest, previewReview },
    { runMode, serverChatId },
    catalogToolNames,
    canAskUser,
  );

  // A request served by a different model than the last turn's — or by one whose known
  // window is under the working budget — is re-packed for that window (`windowFit/`).
  // The summarizer reads the run's LIVE policy, so it is resolved per request.
  const windowFit = createRunWindowFit({
    workingBudgetTokens: HISTORY_TOKEN_BUDGET,
    summarizer: () => ({ stream, model: run.policy.model, signal: c.abort?.signal, ...(req.onDeviceTasks ? { onDeviceTasks: req.onDeviceTasks } : {}) }),
    ...(evermind?.recall ? { recall: (q: string) => evermind.recall(q), priorRecall } : {}),
    ...(req.windowSources ? { windowSources: req.windowSources } : {}),
    trace: (ev) => pushTrace(c, ev),
    now: nowIso,
  });

  const run: BrainRunContext = {
    chatId,
    serverChatId,
    runKey,
    c,
    req,
    ...(reportRunRow ? { reportRunRow } : {}),
    convo,
    canAskUser,
    allTools,
    catalogToolNames,
    alwaysAdvertised,
    promptTools,
    // Tools this run has actually called — pinned into every later turn's selection
    // so a multi-step task never loses a tool it is mid-way through using.
    usedTools: new Set<string>(),
    // Tools an earlier turn of THIS conversation called or named — a follow-up ("yes, do it") keeps the tool the
    // last reply used or promised, instead of losing it to the relevance cut (`conversationPins.ts`).
    conversationPinnedTools: conversationPinnedTools(convo, catalogToolNames),
    systemPrompt,
    metadata,
    recalled,
    recallBlockTokens,
    memoryReplay,
    userRequest,
    publishHold: hold,
    shipPolicy: c.shipPolicy,
    // The goal a hand-off states to coders who see none of this chat: the latest
    // message, and for a change request the chat's earlier change asks (`chatAsks.ts`).
    goal: reading.goal,
    // One re-prompt per run for a final reply that repeats the previous turn's answer
    // (see `restatedReply.ts`). Captured before the loop: the transcript grows as it runs.
    priorReply: previousReplyText(convo),
    // The user's ACTUAL request for this run, resolved once. Every turn's tool
    // selection scores against this and nothing else — see `run/brainPlatformTools.ts`.
    requestQuery: routingQueryForTurn(convo),
    windowFit,
    // What this run has already read. Two guards, one tally (see `readCoverage.ts`):
    // an EXACT repeat of a successful read-only call — same tool, same arguments —
    // returns an "already returned above" stub instead of re-fetching + re-injecting
    // the payload; and a target re-read at SHIFTING offsets gets an advisory once it
    // starts circling. Both are invalidated together, and only for what a later
    // mutation actually touched — never wiped wholesale by an unrelated call.
    readCoverage: new ReadCoverage(),
    // The run's ONE no-progress counter, fed by the read-coverage above and handed to the
    // kernel (`run/runPrepared.ts`) to persist into `RunState.reads.servedStreak` — the Brain
    // owns the instance it feeds, so a kernel-built twin would start empty and die at any step
    // boundary. The Brain builds its context fresh per invocation (no kernel-resume path), so
    // this starts empty; the kernel seeds the counter from saved state for callers that resume.
    cacheStreak: new CacheServedStreak(),
    // Child reports the inbox delivered, for the agent's A3 detector to read (`run/brainProgressPorts.ts`).
    childReports: [],
    childWorkRefs: new Set(req.childWorkRefs),
    // What the run did and read, restated in front of every turn (its `brief()`) —
    // the host's recorder when it keeps one, so the ledger and its code map agree.
    knowledge: recorderFor(userRequest, req.knowledge),
    // What this run has already FAILED at (see `FailureTally` in `@builderforce/run-guards`). The read guards
    // above deliberately record only SUCCESSES, so an identical failing call — the same
    // `git_status` answered with the same remedy three times, the same platform read
    // answered 502 twice — got no pushback at all and could repeat until the budget was
    // gone. The first retry stays free; from the second the model reads the count and the
    // error it already has, and the moves that remain.
    failures: new FailureTally(),
    // What this run has already WRITTEN (see `WriteLedger` in `@builderforce/run-guards`): the third circling shape —
    // a successful full-content write sent again byte for byte, because an error from
    // before it was still on screen. Replaying it cannot change the file, so it is answered
    // without running.
    writeLedger: new WriteLedger(),
    // Placeholders this run wrote and has not removed — read when a ticket is marked done
    // (see `completionGuard.ts`).
    placeholderLedger: new PlaceholderLedger(),
    // The evidence ledger the ship gates read (PRD 45 §4.2) — one per run, fed only by
    // the host's verifier; a host that binds no port leaves every gate inert.
    evidence: createEvidenceLedger(),
    // THE model hand-off policy is the AGENT's: `brainRunPolicy` (`run/webAdapter.ts`) seeds
    // it (the request's model + strictness) and `openRun` folds the route's start into it
    // (plan/code phase, the host's stage models, a quick run's model). It is read here only
    // through the live view, so there is no second copy of the pin or the route.
    get policy(): RunPolicyState {
      if (!run.view) throw new Error('run.policy read before the agent opened the run');
      return run.view.policy();
    },
    route,
    // One re-prompt per run for a code change left unshipped (see `selfReviewShip.ts`).
    // One, not a budget: the second time the model stops short it has read the contract
    // twice, and its answer — including "I cannot ship this because…" — is the answer.
    shipRecoveryUsed: false,
    reviewRecoveryUsed: false,
    // One redirect per run for an explicit sub-agent request the run neither started nor
    // refused on a real result (see `delegationRequest.ts`).
    delegationRecoveryUsed: false,
    restateRecoveryUsed: false,
    // One redirect per run for a narration turn that ended while a tool call was still running
    // (see `deliveryGates.ts`): the run is mid-task, not answering.
    pendingNarrationRecoveryUsed: false,
    // A finishing run traces the delivery gates it skipped once (`run/finishSkipsGates.ts`).
    finishSkipNoted: false,
    stopHookRounds: 0,
    redirectAskToDelegation: false,
    pending: new PendingCalls(),
    lastTurnInterruption: null,
  };
  // Attached LAST: every read of the user's own words above (`userRequest`,
  // `requestQuery`, `priorReply`, the follow-up gate) has already been taken. No user
  // message to carry it → it stays where it always was, in the system prompt.
  if (turnContext && !attachTurnContext(c, convo, turnContext)) {
    run.systemPrompt = `${systemPrompt}\n\n${turnContext}`;
  }
  // The files the block served whole are this run's reads already (E2 ↔ E1), anchored
  // to the message that carries them (none ⇒ the system prompt: replayed from cache).
  recordServedReads(run.readCoverage, host.servedReads, turnContextCarrier(c));
  return run;
}
