/**
 * Everything a run resolves ONCE, before its first turn — the catalog it advertises,
 * the recall and memory answer, the system prompt with every directive folded in, the
 * read/write/failure guards, and the run policy it starts from. Returns the loop's
 * shared state ({@link RunLoopContext}), or null when memory answered and the run is over.
 */

import { ASK_USER_TOOL, ASK_USER_TOOL_SPEC } from '@builderforce/agent-loop';
import { initialRunPolicy } from '@builderforce/run-policy';
import { deviceLeverOn } from './deviceLevers';
import { toolNamesMentionedIn, memoryReplayable } from '@builderforce/agent-stall';
import type { CompletionMetadata } from '../streamChatCompletion';
import { HAND_OFF_TOOL_SPEC } from '../planHandoff';
import { canChangeCodeHere, canShipHere, canReviewInPreview, localToolsIn, memoryToolsIn, studioToolsIn } from '../localWorkspaceTools';
import { skillToolsIn } from '../skillLibraryTools';
import { chatModeDirective, normalizeChatMode } from '../chatMode';
import { routingQueryForTurn, turnOptimizationDirective } from '../turnOptimization';
import { selfReviewShipDirective } from '../selfReviewShip';
import { previewReviewDirective } from '../previewReview';
import { previousReplyText } from '../restatedReply';
import { ReadCoverage } from '../readCoverage';
import { CacheServedStreak } from './cacheServedStreak';
import { RunProgressGuard } from './progressGuard';
import { readRequest } from './requestReading';
import { RunKnowledgeRecorder, type RunKnowledgeLog } from '@builderforce/agent-tools';
import { FailureTally, WriteLedger } from '@builderforce/run-guards';
import { PlaceholderLedger } from '../completionGuard';
import { HISTORY_TOKEN_BUDGET } from '@seanhogg/builderforce-memory/working';
import { recordTranscriptAnchors } from './runFoldMarker';
import { createRunWindowFit } from '../windowFit/runWindowFit';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';
import { isFollowUpTurn, latestUserText } from './convoText';
import { answerFromMemory, recallForRun } from './runMemory';
import { gatherHostRunContext, recordServedReads } from './hostRunContext';
import type { RunLoopContext } from './runLoopContext';
import type { BrainRunRequest } from './runTypes';
import { attachTurnContext, restoreTurnContext, turnContextBlock, turnContextCarrier } from './turnContext';
import { resolveServerChatId } from './serverChat';
import { decideRunPipeline, pipelineMetadata, pipelinePolicyOptions } from './pipelineRoute';

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

export async function prepareRunLoop(chatId: number, c: RunCell, req: BrainRunRequest, runKey: number): Promise<RunLoopContext | null> {
  const { resolvedSystemPrompt, tools: toolSpecs, model, modelStrict, runTool, stream, evermind } = req;
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
  // The catalog the model is shown, PLUS the conversational `ask_user` tool.
  //
  // `ask_user` is injected here rather than registered as a host action because it is
  // not an action: nothing executes it. It is a way for the run to END — the loop
  // intercepts the call as terminal and replies with the question (see
  // `beforeToolCalls`). Injected only where a tool call can be made at all, because on
  // a surface with no tool runner an advertised tool is a trap: the model's call would
  // be discarded and the question lost.
  //
  // Before this, only the server-side reply loop offered it, so a question asked in the
  // editor's chat could only ever arrive as prose — while that very surface rendered
  // `<QuestionCard>` / `<PendingQuestionBanner>` for a block nothing could produce.
  //
  // Gated on the host ALREADY having a catalog, not merely on having a runner. An
  // empty catalog is a FAULT SIGNAL — "zero tools advertised" is how a failed tenant
  // tool load is told apart from a model that simply declined to act — and injecting
  // one tool into it would report a broken catalog as a working one.
  const canAskUser = !!runTool && (toolSpecs?.length ?? 0) > 0;
  // `hand_off` rides the same gate: it is how PLANNING ends (see `planHandoff.ts`) — the
  // planner names the tasks, the run files them and hands them to the coding model(s).
  // Advertised only while the run is still planning; see `completeTurn.ts`.
  const catalog = canAskUser ? [...(toolSpecs ?? []), ASK_USER_TOOL_SPEC, HAND_OFF_TOOL_SPEC] : toolSpecs;
  const allTools = catalog && catalog.length > 0 ? catalog : undefined;
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
  // The SERVER chat (PRD 36): on a local-first host `chatId` is a view key that never
  // leaves the machine, so an unbound chat sends no chat id at all — never its own number,
  // which named (and billed) whichever server chat happened to share it.
  const serverChatId = resolveServerChatId(chatId, req);
  // Full pipeline or a quick pass — decided ONCE, on the user's own request, before any
  // turn (see `pipelineRoute.ts`). Every call carries the route, so the gateway's usage
  // row and the device's ledger row both say which pipeline spent the tokens.
  const pipeline = decideRunPipeline(req, latestUserText(convo), { followUp: isFollowUpTurn(convo) });
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
    ...pipelineMetadata(pipeline),
  };

  // What the host hands the run before turn 1, in one wait (see `hostRunContext.ts`): the
  // recall hint (its context pack's focus files + headings) widens the query past the
  // bare sentence; the model preflight (E7) is on the banner before the first turn.
  const host = await gatherHostRunContext(c, req, !!evermind?.recall);
  const { recalled, block: recallBlock, blockTokens: recallBlockTokens } = await recallForRun(c, convo, evermind, host.recallHint);
  let systemPrompt = resolvedSystemPrompt;
  if (recallBlock) {
    if (stablePrefix) turnParts.push(recallBlock);
    else systemPrompt = `${systemPrompt}\n\n${recallBlock}`;
  }
  const priorRecall = { query: latestUserText(convo), result: recalled };

  // May memory stand in for this turn at all — and may this turn's answer be stored for
  // next time? Decided ONCE, here, before the transcript grows, because only this loop
  // holds the conversation: a stored reply is keyed on the question's words, so it can
  // only answer a question that means the same thing everywhere — the opening turn of a
  // conversation, not "status?" three turns in (which replayed another chat's ticket
  // report). The same gate covers every tier: on-device, the Q&A cache and Evermind.
  const memoryReplay = memoryReplayable(latestUserText(convo), { followUp: isFollowUpTurn(convo) });
  if (await answerFromMemory(chatId, c, req, allTools, memoryReplay)) return null;

  // The host's task context (its context pack, E2) is ALWAYS volatile: it changes every
  // run, so it rides after the history whatever the stable-prefix lever says.
  if (host.turnContext) turnParts.push(host.turnContext);

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
        else systemPrompt = `${systemPrompt}\n\n${extra}`;
      }
    } catch {
      // ignore — proceed without the augmentation
    }
  }

  // Bind this run to the conversation's MODE (migration 0409).
  //
  // WORK: tell the model its chatId, that work it identifies or code it changes must
  // become a ticket LINKED to this chat, and that it must dispatch an agent to run it.
  // This is the enabler the chat-scoped + from_delta tools need — without the id they
  // are advertised but the model has no chatId to pass.
  //
  // CHAT: answer the question; do not mint board work as a side effect of answering.
  //
  // Injected here (with the guaranteed-resolved id) so it rides BOTH the web Brain and
  // the VS Code webview Brain, mirroring the server-side @agent reply loop
  // (BrainService.agentReply). `chatMode` is optional and defaults to WORK so any host
  // that has not adopted the mode yet keeps the behaviour it shipped with.
  // The tools this host advertised for the run, by name. Resolved once: it answers both
  // "may this session change code itself" (below) and "which local tools must never be
  // trimmed away" (the selection pin further down), and those two must see one catalog.
  const catalogToolNames = (req.tools ?? []).map((t) => t.function.name);
  // WORK mode's ordering depends on what THIS surface can do: an IDE run holding the
  // workspace tools should make a small change itself rather than hire a cloud agent to
  // make it, while a web run (no file tools) can only ever get code changed by
  // dispatching. Derived from the run's own advertised tools, so no host declares its
  // capability separately — and a host that gains or loses the file tools stays
  // consistent with the post-run backstop, which reads the same set.
  const canEditHere = canChangeCodeHere(catalogToolNames);
  systemPrompt = `${systemPrompt}\n\n${chatModeDirective(runMode, serverChatId, { canEditHere, canDelegate: catalogToolNames.includes('spawn_agent'), canFanOut: catalogToolNames.includes('spawn_agents'), roster: req.chatRoster })}\n\n${turnOptimizationDirective()}`;
  // A session that can commit AND push holds the only copy of its change — nobody else
  // will review or land it — so it is told it IS the reviewer (see `selfReviewShip.ts`).
  // Rides both modes: it only binds a turn that changes code.
  const canShip = canShipHere(catalogToolNames);
  if (canShip) systemPrompt = `${systemPrompt}\n\n${selfReviewShipDirective(serverChatId)}`;
  // The Studio's twin: its change lives in a preview no one else can reach, so the
  // session reviews it there and the reviewed tickets close (see `previewReview.ts`).
  if (canReviewInPreview(catalogToolNames)) systemPrompt = `${systemPrompt}\n\n${previewReviewDirective(serverChatId)}`;
  // The tool work of this chat's earlier turns, which a transcript seeded from history
  // does not carry — so "continue" builds on what was read instead of reading it again.
  if (c.priorResearch) systemPrompt = `${systemPrompt}\n\n${c.priorResearch}`;

  // What the person's request means for this run: their own words, the directives
  // they imply (a bare continuation, the chat's change asks) and the hand-off goal
  // (`requestReading.ts`). The directives ride the same channel as every other.
  const reading = readRequest(c, convo, runMode);
  const { userRequest } = reading;
  for (const directive of reading.directives) {
    if (stablePrefix) turnParts.push(directive);
    else systemPrompt = `${systemPrompt}\n\n${directive}`;
  }

  // Tool names the resolved system prompt tells the model to call. Always advertised.
  //
  // This only catches `builtin_*` / `mcp__*` identifiers, which is the right pattern
  // for a catalog tool named in prose but blind to the LOCAL workspace tools —
  // `run_command`, `read_file`, `edit_file` and the rest carry no such prefix. The IDE
  // persona names every one of them ("use run_command for git … to commit, push, and
  // open a PR") and pinned none, so on the turn that asked for a commit `run_command`
  // scored zero against "commit the change and push to main", missed the 64-tool cut,
  // and the agent reported that the tool its own prompt had promised did not exist —
  // then burned 78 calls and 44 minutes looking for it.
  //
  // Those tools are not one domain among many that a query may be relevant to; they are
  // what this surface IS. Every one the host advertised is pinned, so relevance can
  // never decide whether the agent may touch the workspace it is sitting in. On a
  // surface without them (the web Brain) the intersection is empty and nothing changes.
  // The per-turn block is model-facing prose too: a tool it names is pinned exactly as
  // one named in the system prompt was when the block lived there.
  const turnContext = turnContextBlock(turnParts);
  const alwaysAdvertised = [
    ...toolNamesMentionedIn(turnContext ? `${systemPrompt}\n\n${turnContext}` : systemPrompt),
    ...localToolsIn(catalogToolNames),
    // The Studio's workspace vocabulary, including the preview review its contract
    // requires — empty everywhere but the Studio (see `studioToolsIn`).
    ...studioToolsIn(catalogToolNames),
    // The project-memory pair (recall before re-reading; remember what was learned) is
    // the cheapest tool in the catalog and the first one relevance would drop.
    ...memoryToolsIn(catalogToolNames),
    // The workspace's Agent Skills — its description IS the skill catalog, so dropping
    // it on relevance would hide every reviewed procedure the workspace has.
    ...skillToolsIn(catalogToolNames),
    // Asking the user is never off-topic: it is how the run stops when it cannot
    // proceed, so relevance against the request must not be what decides whether the
    // agent is allowed to ask. Its one schema is also the cheapest in the catalog.
    ...(canAskUser ? [ASK_USER_TOOL] : []),
  ];

  // A request served by a different model than the last turn's — or by one whose known
  // window is under the working budget — is re-packed for that window (`windowFit/`).
  // The summarizer reads the run's LIVE policy, so it is resolved per request.
  const windowFit = createRunWindowFit({
    workingBudgetTokens: HISTORY_TOKEN_BUDGET,
    summarizer: () => ({ stream, model: run.policy.model, signal: c.abort?.signal }),
    ...(evermind?.recall ? { recall: (q: string) => evermind.recall(q), priorRecall } : {}),
    ...(req.windowSources ? { windowSources: req.windowSources } : {}),
    trace: (ev) => pushTrace(c, ev),
    now: nowIso,
  });

  const run: RunLoopContext = {
    chatId,
    serverChatId,
    runKey,
    c,
    req,
    convo,
    canAskUser,
    allTools,
    catalogToolNames,
    alwaysAdvertised,
    // Tools this run has actually called — pinned into every later turn's selection
    // so a multi-step task never loses a tool it is mid-way through using.
    usedTools: new Set<string>(),
    systemPrompt,
    metadata,
    recalled,
    recallBlockTokens,
    memoryReplay,
    userRequest,
    // The goal a hand-off states to coders who see none of this chat: the latest
    // message, and for a change request the chat's earlier change asks (`chatAsks.ts`).
    goal: reading.goal,
    // One re-prompt per run for a final reply that repeats the previous turn's answer
    // (see `restatedReply.ts`). Captured before the loop: the transcript grows as it runs.
    priorReply: previousReplyText(convo),
    // The user's ACTUAL request for this run, resolved once. Every turn's tool
    // selection scores against this and nothing else — see `completeTurn.ts`.
    requestQuery: routingQueryForTurn(convo),
    windowFit,
    // What this run has already read. Two guards, one tally (see `readCoverage.ts`):
    // an EXACT repeat of a successful read-only call — same tool, same arguments —
    // returns an "already returned above" stub instead of re-fetching + re-injecting
    // the payload; and a target re-read at SHIFTING offsets gets an advisory once it
    // starts circling. Both are invalidated together, and only for what a later
    // mutation actually touched — never wiped wholesale by an unrelated call.
    readCoverage: new ReadCoverage(),
    // How many calls in a row that cache has answered — a run circling its own reads
    // is forced to hand off or change (`cacheServedStreak.ts`).
    cacheStreak: new CacheServedStreak(),
    // The A3 progress detector — a run that says it is ready and keeps reading, circles,
    // undoes its own edit or repeats a failure is steered, then forced, then asked
    // about (`progressGuard.ts`, PRD 35 WS8p).
    progress: new RunProgressGuard(),
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
    // What this run has already WRITTEN (see `repeatedWrite.ts`): the third loop shape —
    // a successful full-content write sent again byte for byte, because an error from
    // before it was still on screen. Replaying it cannot change the file, so it is answered
    // without running.
    writeLedger: new WriteLedger(),
    // Placeholders this run wrote and has not removed — read when a ticket is marked done
    // (see `completionGuard.ts`).
    placeholderLedger: new PlaceholderLedger(),
    // THE model hand-off policy (`@builderforce/run-policy`), shared with every other agent
    // loop. ANALYSIS first, then the CODE: under auto-routing each turn tells the gateway
    // what kind of call it is. Until the run reaches its first code change the turns are
    // analysis (`plan` — the tenant's own precedence decides who plans); from then on they
    // are `code`, which the gateway leads with the strongest connected model. A run that
    // already changed code (a resumed turn) starts as `code`. The policy also holds the
    // model this run is CURRENTLY talking to, every model it has already tried, and the
    // models that broke mid-turn: a model that burns its whole stall budget fails over to
    // another one rather than handing the user a promise (see the final-answer hook),
    // and one that breaks mid-stream is routed around for the rest of the run. A pinned
    // model is the user's own choice and is never routed around.
    policy: initialRunPolicy({
      pinnedModel: model,
      strictPin: modelStrict,
      // Every run starts the same way, whatever the chat's history: a chat that coded
      // before used to start every later run in `code`, which skipped the analysis
      // budget and let an old chat read forever while a fresh one handed off (chat
      // #5739). The one exception is a ROLE, not history — a sub-agent is a delegated
      // SLICE its owner already planned; started in `plan` it was offered `hand_off` and
      // the analysis all over again, inside work it was handed to carry out. A QUICK
      // run (`pipelineRoute.ts`) starts in `code` too, on the quick model. The host's
      // stage models ride as `phaseModels`, never as one model pinned to the whole run.
      ...pipelinePolicyOptions(req, pipeline),
    }),
    pipeline,
    // Bounded counter for the announced-but-never-made tool call recovery, so a model
    // that keeps narrating instead of acting cannot spin the loop. Not one-shot: a model
    // that stalls once frequently stalls again on the very next turn, and spending the
    // single retry on the first stall left the user holding the SECOND promise. The
    // stall budget (`agent-stall`) bounds these recoveries on its own — a run has no
    // iteration ceiling to fall back on.
    forceToolChoice: undefined,
    announcementRecoveries: 0,
    // One re-prompt per run for a code change left unshipped (see `selfReviewShip.ts`).
    // One, not a budget: the second time the model stops short it has read the contract
    // twice, and its answer — including "I cannot ship this because…" — is the answer.
    shipRecoveryUsed: false,
    reviewRecoveryUsed: false,
    // One redirect per run for an explicit sub-agent request the run neither started nor
    // refused on a real result (see `delegationRequest.ts`).
    delegationRecoveryUsed: false,
    restateRecoveryUsed: false,
    stopHookRounds: 0,
    redirectAskToDelegation: false,
    pendingReplay: null,
    pendingRun: null,
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
