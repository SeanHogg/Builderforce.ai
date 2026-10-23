/**
 * Everything a run resolves ONCE, before its first turn — the catalog it advertises,
 * the recall and memory answer, the system prompt with every directive folded in, the
 * read/write/failure guards, and the run policy it starts from. Returns the loop's
 * shared state ({@link RunLoopContext}), or null when memory answered and the run is over.
 */

import { ASK_USER_TOOL, ASK_USER_TOOL_SPEC } from '@builderforce/agent-loop';
import { initialRunPolicy } from '@builderforce/run-policy';
import { isCostLeverOn } from '@builderforce/cost-levers';
import {
  toolNamesMentionedIn,
  isContinuationDirective,
  promisesUnfinishedWork,
  continuationDirective,
  memoryReplayable,
} from '@builderforce/agent-stall';
import type { CompletionMetadata } from '../streamChatCompletion';
import { HAND_OFF_TOOL_SPEC } from '../planHandoff';
import { canChangeCodeHere, canShipHere, canReviewInPreview, localToolsIn, memoryToolsIn, studioToolsIn } from '../localWorkspaceTools';
import { chatModeDirective, normalizeChatMode } from '../chatMode';
import { routingQueryForTurn, turnOptimizationDirective } from '../turnOptimization';
import { selfReviewShipDirective } from '../selfReviewShip';
import { previewReviewDirective } from '../previewReview';
import { previousReplyText } from '../restatedReply';
import { ReadCoverage } from '../readCoverage';
import { FailureTally, WriteLedger } from '@builderforce/run-guards';
import { PlaceholderLedger } from '../completionGuard';
import { HISTORY_TOKEN_BUDGET } from '../workingTranscript';
import { createRunWindowFit } from '../windowFit/runWindowFit';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';
import { isFollowUpTurn, lastAssistantText, latestUserText } from './convoText';
import { answerFromMemory, recallForRun } from './runMemory';
import type { RunLoopContext } from './runLoopContext';
import type { BrainRunRequest } from './runTypes';
import { attachTurnContext, restoreTurnContext, turnContextBlock } from './turnContext';

/**
 * B1 (`b1_stable_prefix`): per-turn blocks ride AFTER the history instead of in the
 * system prompt. On-device there is no tenant to bucket by, so this reads the manifest
 * default plus any env a Node host exposes (`COST_LEVER_B1_STABLE_PREFIX=off`).
 */
function stablePrefixOn(): boolean {
  const env = (globalThis as { process?: { env?: unknown } }).process?.env;
  return isCostLeverOn(env, 'b1_stable_prefix', null);
}

export async function prepareRunLoop(chatId: number, c: RunCell, req: BrainRunRequest, runKey: number): Promise<RunLoopContext | null> {
  const { resolvedSystemPrompt, tools: toolSpecs, model, modelStrict, runTool, stream, evermind } = req;
  const convo = c.transcript;
  // The previous run's per-turn block goes back off its user message BEFORE anything
  // here reads the history (recall query, follow-up test, routing query) — see `turnContext`.
  restoreTurnContext(c);
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
  const metadata: CompletionMetadata = {
    chatId,
    guestTurnId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    guestTurnInput: latestUserText(convo),
    mode: runMode,
    ...(req.projectId != null ? { projectId: req.projectId } : {}),
  };

  const { recalled, block: recallBlock, blockTokens: recallBlockTokens } = await recallForRun(c, convo, evermind);
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
  systemPrompt = `${systemPrompt}\n\n${chatModeDirective(runMode, chatId, { canEditHere, canDelegate: catalogToolNames.includes('spawn_agent'), canFanOut: catalogToolNames.includes('spawn_agents'), roster: req.chatRoster })}\n\n${turnOptimizationDirective()}`;
  // A session that can commit AND push holds the only copy of its change — nobody else
  // will review or land it — so it is told it IS the reviewer (see `selfReviewShip.ts`).
  // Rides both modes: it only binds a turn that changes code.
  const canShip = canShipHere(catalogToolNames);
  if (canShip) systemPrompt = `${systemPrompt}\n\n${selfReviewShipDirective(chatId)}`;
  // The Studio's twin: its change lives in a preview no one else can reach, so the
  // session reviews it there and the reviewed tickets close (see `previewReview.ts`).
  if (canReviewInPreview(catalogToolNames)) systemPrompt = `${systemPrompt}\n\n${previewReviewDirective(chatId)}`;
  // The tool work of this chat's earlier turns, which a transcript seeded from history
  // does not carry — so "continue" builds on what was read instead of reading it again.
  if (c.priorResearch) systemPrompt = `${systemPrompt}\n\n${c.priorResearch}`;

  // A bare "Fix" / "do it" / "go ahead" has no subject of its own — it points at the
  // proposal in the previous assistant turn. Read as a fresh, contextless request it
  // is genuinely ambiguous, and the model then does the reasonable-looking thing: it
  // asks what to fix, while the answer sits one message above it in the same
  // transcript. The user has to re-explain something they already said, and the turn
  // produced nothing.
  //
  // Resolved HERE rather than left to the model to notice, because the connection is
  // structural and cheap to verify — a contentless directive landing directly on a
  // turn that promised unfinished work — and because a model that misreads it burns a
  // whole turn asking.
  // The user's OWN request for this run, captured once. Every later read of the
  // transcript would find the loop's own recovery nudge instead — and the handoff gate
  // in the final-answer hook asks "did the USER ask for a change?", a question a nudge
  // cannot answer.
  const userRequest = latestUserText(convo);
  if (isContinuationDirective(userRequest) && promisesUnfinishedWork(lastAssistantText(convo))) {
    if (stablePrefix) turnParts.push(continuationDirective());
    else systemPrompt = `${systemPrompt}\n\n${continuationDirective()}`;
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'turn.continuation_resolved',
      result: "The user's bare directive was resolved against the previous turn's unfinished proposal, so the run carries that proposal out instead of asking what to fix.",
    });
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
      startPhase: c.codeChanged || c.codePhaseReached ? 'code' : 'plan',
    }),
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
  return run;
}
