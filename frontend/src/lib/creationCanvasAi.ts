import {
  fetchMcpToolEntries,
  mcpActionsFrom,
  streamChatCompletion,
  formatEvermindMemoryBlock,
  countReconciledMemories,
  type BrainAction,
  type BrainTraceEvent,
  type BrainToolSpec,
  type ChatCompletionMessage,
  type EvermindRecallResult,
  type ChatMode,
  selectToolsForTurn,
  turnInterruption,
} from '@seanhogg/builderforce-brain-embedded';
import { brainConfig } from '@/lib/brain/runtime';
import { guestBrainConfig } from '@/lib/brain/guestRuntime';
import { ensureGuestToken } from '@/lib/guestRoomApi';
import { GUEST_RESEARCH_ACTIONS } from '@/lib/guestResearchActions';
import { loadGuestCareerActions } from '@/lib/guestCareerActions';
import { conversationSpeakerLabels, echoesEarlierAnswer, stripSpeakerLabel } from '@/lib/canvasTranscript';
import {
  NON_AUTHORING_TOOL_NAMES,
  RESEARCH_TOOL_NAMES,
  WORDS_PER_DRAFT_PAGE,
  authoredDocumentWords,
  documentWordsInSnapshot,
  incompleteDocumentAnswer,
  isExecutiveTeammateRequest,
  isNarrowSearchResult,
  requestedPagesForTurn,
  requestsCanvasMutation,
  snapshotHasTabularRows,
  toolOutcomeChangedCanvas,
  unverifiedCreationClaim,
} from '@/lib/canvasTurnOutcome';
import { CANVAS_BUILD_WORKSPACE_WRITE_TOOLS } from '@/lib/canvasBuildTools';
import { CANVAS_STREAM_STALL_MS, CanvasStreamStalledError, streamBoundedByActivity } from '@/lib/canvasStreamWatchdog';
import type { CanvasNotices } from '@/lib/canvasNotices';
import { canvasSystemMessages, promptNamedTools } from '@/lib/canvasAiSystemPrompt';
import { CanvasRunAbortedError, GuestAiUnavailableError } from '@/lib/canvasAiErrors';
import {
  CANVAS_BUILD_RESPONSE_TOKENS,
  CANVAS_RESPONSE_TOKENS,
  CANVAS_TOOL_LIMIT,
  MALFORMED_CALL_RESULT,
  MALFORMED_TOOL_CALL_DIRECTIVE,
  MAX_CANVAS_BUILD_TURNS,
  MAX_CANVAS_TOOL_TURNS,
  MAX_INTERRUPTED_TURN_RECOVERIES,
  MAX_MUTATION_RECOVERIES,
  MAX_NARROW_SEARCHES,
  MAX_STALLED_STREAMS,
  RESERVED_AUTHORING_TURNS,
  TRUNCATED_CALL_RESULT,
  TRUNCATED_ROUND_DIRECTIVE,
  TRUNCATED_TURN_DIRECTIVE,
} from '@/lib/canvasAiTurnBudget';
import { runAgentLoop, openAiChatCodec } from '@builderforce/agent-loop';
import { toolErrorMessage } from '@/lib/toolErrorMessage';

type CanvasAiOptions = {
  prompt: string;
  /** Stable across every agent/model iteration caused by one composer submit. */
  guestTurnId?: string;
  /** Original composer text when this is an internal specialist/synthesis call. */
  guestTurnInput?: string;
  canvasSnapshot: string;
  persistence: 'local' | 'server';
  canvasActions: BrainAction[];
  /**
   * Every sentence this turn can return that the MODEL did not write, already in the
   * viewer's language. Required, not defaulted: an English fallback here would be a
   * second source for text the catalogs own, and the notices reach the user as Brain
   * speaking (see `lib/canvasNotices.ts`).
   */
  notices: CanvasNotices;
  model?: string;
  modelStrict?: boolean;
  routingMode?: 'auto' | 'byo_pool';
  /** Uses the same persisted mode as the canonical Brain: mutating tenant tools run
   * without an additional browser confirmation and canvas proposals auto-apply. */
  autoApprove?: boolean;
  evermind?: {
    recall: (query: string) => Promise<EvermindRecallResult | null>;
    learn: (answer: string, prompt: string) => Promise<{ ok: boolean; queued?: number }>;
  };
  onTrace?: (event: BrainTraceEvent) => void;
  /** Session diagnostics hook. Contains routing facts only; never prompt text,
   * credentials, or provider response bodies. */
  onCompletion?: (completion: CanvasAiCompletion) => void;
  /** Models that already proved unable to execute a Canvas command in this
   * session. An explicitly selected rejected model must not be invoked again. */
  disabledModels?: readonly string[];
  onModelDisabled?: (model: string) => void;
  /** Fired when a command-stalled model is replaced by a model that already
   * demonstrated tool calling earlier in the same turn. */
  onModelFallback?: (model: string) => void;
  /**
   * Fired when the string this function returns is a RUNTIME NOTICE rather than
   * something the model actually said — the turn produced no answer, executed no
   * command, or died on a tool error.
   *
   * The surface needs this to keep the notice OUT of the session transcript. Storing
   * it as an assistant message is what let one failed turn poison every turn after it:
   * the next request carried "I couldn't prepare any canvas changes from that request"
   * as an example assistant reply, and a free model reproduced it verbatim instead of
   * answering (2026-08-12, ui 2026.7.210).
   */
  onUnanswered?: (outcome: { reason: 'no-answer' | 'command-not-executed' | 'tool-error'; detail?: string }) => void;
  /** Awaitable in-app approval. Mutating tenant actions are refused when this is
   * absent; the runner must never fall back to a browser-native prompt. */
  confirmAction?: (request: { name: string; args: unknown }) => Promise<boolean>;
  /** Session-owned transcript. The Canvas is the chat, so prior turns must travel with
   * every request just as they do in the standalone Brain surface. */
  conversation?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  onText?: (text: string) => void;
  /** Optional invited Canvas agent identity. The same bounded Canvas tool loop is
   * used, but the turn is authored from this specialist's configured perspective
   * instead of the session's coordinating Brain. */
  participant?: {
    ref: string;
    name: string;
    instructions?: string;
  };
  /**
   * The session's MODE (migration 0409) — `chat` (author on the canvas and answer) or
   * `work` (turn the conclusion into a tracked, dispatched ticket). Defaults to `chat`,
   * so a canvas turn never opens board work unless the user armed Work.
   */
  mode?: ChatMode;
  /** The canonical project this session is bound to, when it has one. Work mode needs
   *  it to file the ticket somewhere; absent, the model is told to ask for one. */
  projectId?: number | null;
  /**
   * Interrupts the turn — the composer's Stop button. Aborts the in-flight model
   * stream and is re-checked between loop iterations and between tool calls, so a
   * stopped run cannot spend another round-trip or run another tool after the user
   * has said stop. The rejection is always a {@link CanvasRunAbortedError}, so the
   * surface can tell "the user stopped this" apart from "the turn failed".
   */
  signal?: AbortSignal;
};

export interface CanvasAiCompletion {
  at: string;
  iteration: number;
  requestedModel: string | null;
  resolvedModel: string | null;
  resolvedVendor: string | null;
  account: string | null;
  routingMode: 'auto' | 'byo_pool';
  toolsAdvertised: number;
  toolCalls: string[];
  finishReason: string | null;
}

function specsFor(actions: BrainAction[]): BrainToolSpec[] {
  return actions.map((action) => ({
    type: 'function',
    function: { name: action.name, description: action.description, parameters: action.parameters },
  }));
}

function mutates(action: BrainAction, args: unknown): boolean {
  if (typeof action.mutates === 'function') {
    try { return !!action.mutates(args); } catch { return true; }
  }
  return !!action.mutates;
}



/** Run a small, bounded agent loop over the active canvas and shared MCP catalog. */
export async function runCreationCanvasAi(options: CanvasAiOptions): Promise<string> {
  /** Every await boundary a stopped turn must not cross. */
  const throwIfStopped = () => { if (options.signal?.aborted) throw new CanvasRunAbortedError(); };
  throwIfStopped();
  if (options.model && options.disabledModels?.includes(options.model)) {
    throw new Error(`Model '${options.model}' is disabled for this session because it did not execute an earlier Canvas command.`);
  }
  // AUTOMATIC ROUTING IS NEVER REFUSED.
  //
  // This used to throw when auto-select had previously landed on a model that would
  // not execute a command, telling the user to "select a different model". On the free
  // plan there IS no model picker, and on a guest board the gateway deletes any pin the
  // client sends — so the advice named an action the user could not take, and every
  // later turn died in 30ms without reaching a model at all. One weak turn permanently
  // ended the session (measured 2026-08-12, ui 2026.7.212).
  //
  // The list is a ROUTING HINT now, not a veto: it rides the request as `excludeModels`,
  // which the gateway honours only while another candidate remains. Worst case the same
  // model answers again — strictly better than refusing to answer at all.
  const excludeModels = options.model ? [] : (options.disabledModels ?? []);
  if (options.persistence === 'local' && !(await ensureGuestToken())) {
    throw new GuestAiUnavailableError();
  }
  const config = options.persistence === 'server' ? brainConfig : guestBrainConfig;
  const transport = config.transport;
  const guestTurnId = options.guestTurnId ?? crypto.randomUUID();
  let mcpActions: BrainAction[] = [];
  if (options.persistence === 'server') {
    try {
      const entries = await fetchMcpToolEntries(transport);
      mcpActions = mcpActionsFrom(entries, transport);
    } catch {
      // Canvas-native AI remains useful if an MCP extension is temporarily down.
    }
  }
  // A logged-out board has no tenant and therefore no MCP catalog — which is where
  // research lives. Without these three the system prompt below names tools the guest
  // model was never given, and a "research X and chart it" turn resolves from the
  // model's weights instead of from sources. Same NAMES as the MCP ones on purpose
  // (see guestResearchActions), so one prompt is correct on both surfaces.
  const researchActions = options.persistence === 'server' ? [] : GUEST_RESEARCH_ACTIONS;
  // The same argument, one domain over: the career tools (résumé scoring, job match,
  // interview prep, runway) are pure over text the visitor supplies, so a guest gets the
  // IDENTICAL implementation a tenant does rather than a degraded imitation. Fetched
  // from the server catalog rather than re-declared here — see guestCareerActions.
  const careerActions = options.persistence === 'server' ? [] : await loadGuestCareerActions();
  const actions = [...options.canvasActions, ...mcpActions, ...researchActions, ...careerActions];
  const byName = new Map(actions.map((action) => [action.name, action]));
  let recalled: EvermindRecallResult | null = null;
  if (options.evermind) {
    try { recalled = await options.evermind.recall(options.prompt); } catch { recalled = null; }
    if (recalled?.seeded && recalled.items.length) options.onTrace?.({
      ts: new Date().toISOString(), category: 'recall', label: 'evermind.recall',
      args: { query: options.prompt, version: recalled.version },
      result: { count: recalled.items.length, version: recalled.version, mode: recalled.mode, items: recalled.items },
    });
  }
  const memoryBlock = recalled?.seeded ? formatEvermindMemoryBlock(recalled.items) : '';
  const messages = canvasSystemMessages({
    prompt: options.prompt,
    canvasSnapshot: options.canvasSnapshot,
    persistence: options.persistence,
    memoryBlock,
    participant: options.participant,
    mode: options.mode,
    projectId: options.projectId,
    conversation: options.conversation,
  });
  const finish = async (answer: string): Promise<string> => {
    const text = answer.trim();
    if (!options.evermind || !text || text.length < 40 || !recalled) return answer;
    if (!recalled.seeded || recalled.mode === 'offline-frozen') {
      options.onTrace?.({ ts: new Date().toISOString(), category: 'learn', label: 'evermind.learn', result: { version: recalled.version, skipped: true, reason: recalled.seeded ? 'frozen' : 'not-seeded' } });
      return answer;
    }
    try {
      const learned = await options.evermind.learn(text, options.prompt);
      if (learned.ok) {
        options.onTrace?.({ ts: new Date().toISOString(), category: 'learn', label: 'evermind.learn', result: { version: recalled.version, queued: learned.queued ?? true } });
        const reconciled = countReconciledMemories(recalled.items, text);
        if (reconciled) options.onTrace?.({ ts: new Date().toISOString(), category: 'reconcile', label: 'evermind.reconcile', result: { count: reconciled, version: recalled.version } });
      }
    } catch { /* Evermind learning is best-effort and must not fail the canvas turn. */ }
    return answer;
  };
  let finalText = '';
  /** A tool this turn STAGED (`proposed: true`) or COMMITTED (`applied: true`) a canvas
   *  change — see `toolOutcomeChangedCanvas`. */
  let canvasChanged = false;
  let executiveRequestRecoveryUsed = false;
  /** Act-now escalations spent on a model that answered in prose instead of calling a
   *  canvas tool. Two: the first re-states the command, the second runs with research
   *  and board re-reads already withdrawn and tells it why prose is not an artifact. */
  let mutationRecoveries = 0;
  let degenerateAnswerRecoveryUsed = false;
  let interruptedTurnRecoveries = 0;
  /** Round-trips this turn abandoned because the provider went silent. */
  let stalledStreams = 0;
  let authoringDirectiveIssued = false;
  let narrowSearches = 0;
  let lastToolError = '';
  /**
   * The most recent real thing the model SAID this turn — non-empty, not an echo of an
   * earlier reply. Held across iterations because the recovery paths deliberately clear
   * `finalText` before continuing, and one of them then gives up: without this, an
   * answer the model actually produced is unrecoverable by the time the loop ends.
   */
  let lastSpokenAnswer = '';
  let activeModel = options.model;
  let activeModelStrict = options.modelStrict;
  const toolCallingModels: string[] = [];
  const commandFailedModels = new Set(options.disabledModels ?? []);
  /** Labels this session's transcript uses, so a copied `Brain: ` prefix can be
   *  recognised and removed without touching an answer that legitimately opens with
   *  a colon. */
  const speakerLabels = conversationSpeakerLabels(options.conversation, [options.participant?.name]);
  /**
   * Retire the model that just failed to produce a usable turn and continue on one
   * that already emitted valid tool calls in this same turn.
   *
   * Shared by BOTH give-up paths (a command the model would not execute, and an
   * empty/echoed answer) — they differ only in what they tell the replacement model.
   * Returns false when no proven model is left, which is the caller's signal to stop.
   */
  const switchToProvenModel = (failedModel: string | null | undefined, directive: string): boolean => {
    const alreadyFailed = failedModel ? new Set([...commandFailedModels, failedModel]) : commandFailedModels;
    const fallback = [...toolCallingModels].reverse().find((model) => !alreadyFailed.has(model));
    if (!fallback || (fallback === activeModel && activeModelStrict === true)) {
      // NOTHING TO SWITCH TO. Do NOT record the failure in that case: the record's
      // only purpose is to route around the model on a later turn, and a session that
      // has no alternative gains nothing from it while paying the full price — the
      // list is session-scoped, so one weak turn used to end the session outright.
      // Release the pin instead, so the next iteration asks the gateway to choose
      // again rather than re-pinning the model that just failed.
      activeModel = options.model;
      activeModelStrict = options.modelStrict;
      return false;
    }
    if (failedModel) {
      commandFailedModels.add(failedModel);
      options.onModelDisabled?.(failedModel);
    }
    activeModel = fallback;
    activeModelStrict = true;
    mutationRecoveries = 0;
    degenerateAnswerRecoveryUsed = false;
    interruptedTurnRecoveries = 0;
    options.onModelFallback?.(fallback);
    messages.push({ role: 'system', content: `${directive} Continue on ${fallback}, which already emitted valid tool calls in this turn.` });
    return true;
  };
  const notices = options.notices;
  const mutationRequested = !options.participant && requestsCanvasMutation(options.prompt);
  const hasTabularData = snapshotHasTabularRows(options.canvasSnapshot);
  // An informational question is allowed to mention documents, reports, charts,
  // and other artifact nouns. Running the mutation-claim detector on every answer
  // turned ordinary replies such as "here is the standard document format" into
  // "I described a canvas change but did not make one." Only enforce this contract
  // when the user's request actually asked Canvas to create or update something.
  const verified = (answer: string): string =>
    unverifiedCreationClaim(notices, answer, canvasChanged, hasTabularData, mutationRequested) ?? answer;
  const requestedPages = requestedPagesForTurn(options);
  let documentWords: number | null = requestedPages == null ? null : documentWordsInSnapshot(options.canvasSnapshot);
  let documentWordCountExact = false;
  // ── THE loop ────────────────────────────────────────────────────────────────
  // The model→tools→model skeleton lives ONCE in `@builderforce/agent-loop` (the same
  // kernel the cloud engine, the Brain and the on-prem runtime drive). The canvas's own
  // concerns — the reserved authoring phase, the stalled-provider and interruption
  // ladders, the mutation escalation, the confirm gate, the completion diagnostics —
  // are hooks and ports closing over this turn's state. Nothing below iterates.
  type CanvasTurn = Awaited<ReturnType<typeof streamChatCompletion>>;
  /** The answer a turn SETTLED on inside the loop (a `finish(...)` return), or null
   *  when the loop stopped without one and the tail below decides what the user gets. */
  let settled = null as string | null;
  /** Whether THIS round-trip ran in the reserved authoring phase — set per turn by the
   *  model port, read by dispatch to refuse research calls. */
  let authoringOnly = false;
  /** How the LAST completion ended, read by dispatch so a call whose arguments never
   *  parsed is refused with the reason that matches — cut off, or mis-encoded. */
  let lastTurnInterruption: ReturnType<typeof turnInterruption> = null;
  /** Set when dispatch discarded an unusable call this round, so the follow-up
   *  directive is pushed once per round rather than once per call. */
  let discardedCallThisRound = false;
  /** Tools this turn has called so far — pinned through per-turn selection so a
   *  multi-step task never loses a tool mid-flight. */
  const toolsUsedThisTurn = new Set<string>();
  const requiredTools = promptNamedTools(messages);
  /** Set once a workspace write commits: the turn is BUILDING, so it gets the code
   *  output ceiling and the code step budget from then on. */
  let buildTurn = false;
  /** The kernel reads this object every iteration, which is what lets a build turn
   *  widen its own budget the moment its first workspace write commits. */
  const budget = { stepCap: MAX_CANVAS_TOOL_TURNS };
  const loop = await runAgentLoop<ChatCompletionMessage>({
    messages,
    codec: openAiChatCodec<ChatCompletionMessage>(),
    signal: options.signal,
    budget,
    ports: {
      complete: async (ctx) => {
        const turn = ctx.step;
        // The authoring phase arms on EITHER trigger. Turn count alone made it unreachable
        // for the failure it exists to stop: a model that answers in prose instead of
        // calling a tool is told once to act, ignores it, and the loop gives up on turn 4 —
        // three turns before the reserved window it never reaches. Having already ignored
        // an explicit act-now directive is the stronger signal of the two, so it arms the
        // same phase: research and re-reads withdrawn, authoring tools only.
        authoringOnly = mutationRequested && !canvasChanged
          && (mutationRecoveries > 0 || budget.stepCap - turn <= RESERVED_AUTHORING_TURNS);
        if (authoringOnly && !authoringDirectiveIssued) {
          authoringDirectiveIssued = true;
          messages.push({
            role: 'system',
            content: 'The research phase is over. Use the remaining turns only to create or update the requested Canvas artifacts with canvas_* tools. Build from what you already have — you have the board snapshot and do not need to read it again — state any evidence gap inside the artifact, and do not make another search or fetch call.',
          });
        }
        const availableActions = authoringOnly
          ? actions.filter((action) => !NON_AUTHORING_TOOL_NAMES.has(action.name))
          : actions;
        // Per-turn selection (see CANVAS_TOOL_LIMIT). The query is the user's request
        // plus the latest exchange, so a follow-up ("now add a budget screen") still
        // scores the tools its wording names.
        const recent = (options.conversation ?? []).slice(-2).map((message) => message.content).join('\n');
        const selection = selectToolsForTurn(specsFor(availableActions), {
          query: `${options.prompt}\n${recent}`,
          limit: CANVAS_TOOL_LIMIT,
          pinned: toolsUsedThisTurn,
          required: requiredTools,
        });
        let result: CanvasTurn;
        try {
          result = await streamBoundedByActivity(streamChatCompletion, {
            transport,
            messages,
            tools: selection.tools,
            tool_choice: 'auto',
            maxTokens: buildTurn ? CANVAS_BUILD_RESPONSE_TOKENS : CANVAS_RESPONSE_TOKENS,
            reasoning: { level: 'low' },
            model: activeModel,
            modelStrict: activeModelStrict,
            routingMode: options.routingMode,
            // Models this session (or this turn) already proved will not execute a Canvas
            // command. Only meaningful while UNPINNED — with a pin the caller has made the
            // choice — and the gateway ignores it rather than emptying the cascade, so this
            // can steer routing without ever refusing to answer.
            ...(!activeModel && (excludeModels.length || commandFailedModels.size)
              ? { excludeModels: [...new Set([...excludeModels, ...commandFailedModels])] }
              : {}),
            metadata: { guestTurnId, guestTurnInput: options.guestTurnInput ?? options.prompt },
          }, (delta) => { finalText += delta; options.onText?.(finalText); }, options.signal);
        } catch (error) {
          // A STALLED provider is a routing problem, not a content problem, so the ladder is
          // shorter than the interruption one: try again once (a stall is often a single bad
          // connection), then hand the turn to a model that has already worked in it, then
          // stop. Stopping is the point — the alternative is the four-minute spinner this
          // exists to end, and by here the turn still delivers whatever it already has.
          if (!(error instanceof CanvasStreamStalledError)) throw error;
          throwIfStopped();
          stalledStreams += 1;
          options.onTrace?.({
            ts: new Date().toISOString(), category: 'error', label: 'provider stopped responding', isError: true,
            result: { model: activeModel ?? null, seconds: Math.round(CANVAS_STREAM_STALL_MS / 1_000), attempt: stalledStreams },
          });
          finalText = '';
          if (stalledStreams < MAX_STALLED_STREAMS) return { skip: true };
          if (switchToProvenModel(activeModel, 'The prior model stopped responding mid-request and has been disabled for this session.')) {
            stalledStreams = 0;
            return { skip: true };
          }
          // Out of providers: stop, and let the tail deliver whatever the turn already has.
          return { failed: 'provider stopped responding' };
        }
        throwIfStopped();
        options.onCompletion?.({
          at: new Date().toISOString(), iteration: turn + 1,
          requestedModel: activeModel ?? null,
          resolvedModel: result.resolvedModel ?? null,
          resolvedVendor: result.resolvedVendor ?? null,
          account: result.account ?? null,
          routingMode: options.routingMode ?? 'auto',
          toolsAdvertised: selection.tools.length,
          toolCalls: result.toolCalls.map((call) => call.name),
          finishReason: result.finishReason,
        });
        lastTurnInterruption = turnInterruption(result.finishReason);
        if (result.toolCalls.length && result.resolvedModel && !toolCallingModels.includes(result.resolvedModel)) {
          toolCallingModels.push(result.resolvedModel);
        }
        // A bounded tool loop is one logical agent turn. Keep its continuations on
        // the model that began it instead of asking Auto to reroute every tool result
        // independently (which previously moved research from MiniMax to Gemini just
        // before the required Canvas write). This is a preference, not a strict pin:
        // the gateway may still substitute when the provider becomes unavailable.
        if (!activeModel && result.resolvedModel) {
          activeModel = result.resolvedModel;
          activeModelStrict = false;
        }
        return {
          content: result.text,
          toolCalls: result.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.args })),
          meta: result,
        };
      },
      dispatch: async (call) => {
        const toolStartedAt = Date.now();
        const action = byName.get(call.name);
        const args: unknown = call.args;
        // A call whose arguments never parsed is NOT run. The kernel hands it over with
        // `args: {}` and `malformed: true` (its policy: never abort a run on bad JSON),
        // and running it anyway is how three `canvas_write_build_file` calls executed
        // with no path and failed "A path is required." — each one the tail of a
        // response that hit the output ceiling. The model is told which of the two
        // things happened, because the remedies are opposites: send less, or encode
        // correctly. Not recorded as a tool error — the tool never ran.
        if (call.malformed) {
          discardedCallThisRound = true;
          const truncated = lastTurnInterruption === 'truncated';
          const outcome = { error: truncated ? TRUNCATED_CALL_RESULT : MALFORMED_CALL_RESULT };
          options.onTrace?.({
            ts: new Date().toISOString(), category: 'error', isError: true, durationMs: 0,
            label: truncated ? `${call.name} (cut off by the output limit)` : `${call.name} (unparseable arguments)`,
            args: { arguments: call.raw.arguments.slice(0, 200) }, result: outcome,
          });
          return { data: outcome, isError: true };
        }
        toolsUsedThisTurn.add(call.name);
        const words = call.name === 'canvas_add_object' ? authoredDocumentWords(args) : null;
        if (words != null) {
          documentWords = Math.max(documentWords ?? 0, words);
          documentWordCountExact = true;
        }
        let outcome: unknown;
        if (authoringOnly && NON_AUTHORING_TOOL_NAMES.has(call.name)) {
          outcome = { error: 'The bounded research phase has ended. Create the requested Canvas artifacts from the evidence already gathered and the board snapshot you already have.' };
        } else if (call.name === 'builtin_web_search' && narrowSearches >= MAX_NARROW_SEARCHES) {
          outcome = { error: 'Search stopped after two encyclopedic results. Fetch a known official URL directly or create the requested Canvas artifacts with the evidence already gathered.' };
        } else if (!action) {
          outcome = { error: `Unknown tool: ${call.name}` };
        } else if (!call.name.startsWith('canvas_') && mutates(action, args) && !options.autoApprove) {
          const approved = options.confirmAction ? await options.confirmAction({ name: call.name, args }) : false;
          if (!approved) outcome = { error: options.confirmAction ? 'The user declined this tenant mutation.' : 'This tenant mutation requires in-app approval.' };
          else {
            try { outcome = await action.run(args); } catch (error) { outcome = { error: toolErrorMessage(error, 'Tool failed') }; }
          }
        } else {
          try { outcome = await action.run(args); } catch (error) { outcome = { error: toolErrorMessage(error, 'Tool failed') }; }
        }
        if (call.name === 'builtin_web_search' && isNarrowSearchResult(outcome)) narrowSearches += 1;
        if (toolOutcomeChangedCanvas(outcome)) {
          canvasChanged = true;
          if (!buildTurn && CANVAS_BUILD_WORKSPACE_WRITE_TOOLS.has(call.name)) {
            // The turn is writing code from here on (see CANVAS_BUILD_RESPONSE_TOKENS
            // and MAX_CANVAS_BUILD_TURNS). Widened once; never narrowed back.
            buildTurn = true;
            budget.stepCap = Math.max(budget.stepCap, MAX_CANVAS_BUILD_TURNS);
          }
        }
        if (outcome && typeof outcome === 'object') {
          const result = outcome as { error?: unknown };
          if (typeof result.error === 'string' && result.error.trim()
            && !(NON_AUTHORING_TOOL_NAMES.has(call.name) && (authoringOnly || narrowSearches >= MAX_NARROW_SEARCHES))) {
            lastToolError = result.error.trim();
          }
        }
        const isError = !!(outcome && typeof outcome === 'object' && 'error' in outcome);
        options.onTrace?.({ ts: new Date().toISOString(), category: isError ? 'error' : 'tool', label: call.name, durationMs: Math.max(0, Date.now() - toolStartedAt), args, result: outcome, isError });
        return { data: outcome, isError };
      },
    },
    hooks: {
      // A stopped run must not START another tool. One already in flight is left to
      // settle (its own transport owns the cancellation); nothing after it runs.
      beforeDispatch: () => { throwIfStopped(); return undefined; },
      afterToolCalls: () => {
        finalText = '';
        // The complete calls in a cut-off round already ran and the discarded one got
        // its own result above; say once, for the round, how to stop it recurring.
        if (discardedCallThisRound) {
          discardedCallThisRound = false;
          messages.push({
            role: 'system',
            content: lastTurnInterruption === 'truncated' ? TRUNCATED_ROUND_DIRECTIVE : MALFORMED_TOOL_CALL_DIRECTIVE,
          });
        }
        return undefined;
      },
      onNoToolCalls: async (_ctx, turn) => {
        const result = turn.meta as CanvasTurn;
        // An INTERRUPTED turn is not a turn the model chose to end. Truncation at the
        // output ceiling drops the tool call it was mid-way through emitting (its JSON
        // never closes), and an unparseable call is discarded by the provider — both
        // arrive here looking exactly like "the model declined to act", and both used
        // to be answered with "you repeated yourself, answer again", which reproduces
        // the same failure. Handled FIRST, with the directive that matches the actual
        // interruption: author smaller, or re-encode the call.
        const interruption = turnInterruption(result.finishReason);
        if (interruption && interruptedTurnRecoveries < MAX_INTERRUPTED_TURN_RECOVERIES) {
          interruptedTurnRecoveries += 1;
          options.onTrace?.({
            ts: new Date().toISOString(), category: 'error',
            label: interruption === 'truncated' ? 'response truncated' : 'malformed tool call',
            isError: true,
            result: { finishReason: result.finishReason, model: result.resolvedModel ?? null, attempt: interruptedTurnRecoveries },
          });
          messages.push({
            role: 'system',
            content: interruption === 'truncated' ? TRUNCATED_TURN_DIRECTIVE : MALFORMED_TOOL_CALL_DIRECTIVE,
          });
          finalText = '';
          return { action: 'continue' };
        }
        if (interruption && switchToProvenModel(
          result.resolvedModel,
          interruption === 'truncated'
            ? 'The prior model kept running past the output limit without finishing and has been disabled for this session. Author the requested artifact in small steps.'
            : 'The prior model kept emitting tool calls the provider could not parse and has been disabled for this session.',
        )) {
          finalText = '';
          return { action: 'continue' };
        }
        // A DEGENERATE turn — the model returned nothing at all, or reproduced an
        // earlier assistant message instead of answering. Neither is an answer, and
        // neither is caught by the intent-based recoveries below (a plain question
        // degenerates just as easily as a command). Checked FIRST because an echoed
        // reply otherwise reaches the user as a fresh one and is stored, which is what
        // let a single failed turn become the template for every turn after it.
        const spoken = stripSpeakerLabel(result.text || finalText, speakerLabels).trim();
        if (!spoken || echoesEarlierAnswer(spoken, options.conversation, speakerLabels)) {
          if (!degenerateAnswerRecoveryUsed) {
            degenerateAnswerRecoveryUsed = true;
            messages.push({
              role: 'system',
              content: 'Your prior response was empty or repeated an earlier message in this conversation, so it did not answer anything. Do not restate a previous reply, and do not prefix your answer with a speaker name. Answer the user\'s latest message directly now, and call the canvas_* tools for any change it asks for.',
            });
            finalText = '';
            return { action: 'continue' };
          }
          if (switchToProvenModel(result.resolvedModel, 'The prior model returned an empty or repeated response twice and has been disabled for this session.')) {
            finalText = '';
            return { action: 'continue' };
          }
          finalText = '';
          return { action: 'stop', ok: false };
        }
        lastSpokenAnswer = spoken;
        // ESCALATION LADDER for a model that discussed an imperative canvas request
        // instead of executing it. Each rung is tried only when the one before it is
        // spent, hardest-available remedy first:
        //   1. re-state the command;
        //   2. hand the turn to a model that already emitted valid tool calls;
        //   3. no such model exists — re-state once more, now with research and board
        //      re-reads withdrawn, and say why prose is not an artifact;
        //   4. stop, and deliver what the model actually said (see the tail of this
        //      function) instead of a dead-end notice.
        // Rung 3 is what the measured 2026-08-14 failure needed and never got: the only
        // tool-calling model in that turn WAS the stalled one, so rung 2 was a no-op and
        // the loop went straight from rung 1 to giving up, four turns early.
        if (!options.participant && !canvasChanged && mutationRequested
          && (byName.has('canvas_add_object') || byName.has('canvas_update_object'))) {
          if (mutationRecoveries === 0 || (
            !switchToProvenModel(
              result.resolvedModel,
              'The prior model did not execute the Canvas command after a retry and has been disabled for this session. Stop researching and use canvas_add_object or canvas_update_object now to complete the user\'s requested artifact.',
            ) && mutationRecoveries < MAX_MUTATION_RECOVERIES
          )) {
            mutationRecoveries += 1;
            messages.push({ role: 'assistant', content: result.text || finalText });
            messages.push({
              role: 'system',
              // The later attempt runs with research and board re-reads already withdrawn,
              // so repeating "act now" adds nothing. What the first directive never
              // supplies is the reason a model stalls here: it has written the answer in
              // prose and has no idea the prose is not the artifact. Say that, and name
              // the one call left to it.
              content: mutationRecoveries > 1
                ? 'You have now answered twice in prose without creating anything. Prose in a reply is NOT a canvas artifact and the user cannot keep, edit or export it — only a canvas_add_object call puts it on their board. Make that call now, passing the full text you just wrote as the new object\'s authored content, and write nothing else in this response.'
                : 'Your prior response described or discussed an imperative Canvas request without executing it. Act now with the available canvas_add_object or canvas_update_object tool. If a non-Chat object is selected, update that exact object unless the user explicitly requested another one. For a Website/WYSIWYG change, send the complete authored fields.pages structure and websiteTheme; do not ask another optional question and do not rely on renderer defaults.',
            });
            finalText = '';
            return { action: 'continue' };
          }
          // Either the turn moved to a proven model (which reset the ladder) or every
          // rung is spent. Continue in the first case, stop in the second.
          finalText = '';
          if (mutationRecoveries === 0) return { action: 'continue' };
          return { action: 'stop', ok: false };
        }
        if (!options.participant && !canvasChanged && !executiveRequestRecoveryUsed
          && isExecutiveTeammateRequest(options.prompt) && byName.has('canvas_add_object')) {
          executiveRequestRecoveryUsed = true;
          messages.push({ role: 'assistant', content: result.text || finalText });
          messages.push({
            role: 'system',
            content: 'Your prior response did not execute the requested teammate action. Act now: add the named executive Agent, add the fully authored requested deliverable, and connect them with the available Canvas tools. A new canvas is sufficient context; put assumptions and open questions in the deliverable instead of asking a follow-up question.',
          });
          finalText = '';
          return { action: 'continue' };
        }
        if (requestedPages != null && documentWords != null && documentWords < requestedPages * WORDS_PER_DRAFT_PAGE) {
          settled = await finish(incompleteDocumentAnswer(notices, requestedPages, documentWords, documentWordCountExact));
          return { action: 'stop', ok: true };
        }
        // `spoken` is the answer with any copied speaker label already removed, so a
        // model that relapses cannot seed the next turn with a prefix to extend.
        settled = await finish(verified(spoken));
        return { action: 'stop', ok: true };
      },
    },
  });
  // The user pressed Stop between round-trips (a stop mid-stream or mid-tool throws
  // on its own): typed, so the surface records "you stopped this", not a failure.
  if (loop.cancelled) throw new CanvasRunAbortedError();
  if (settled !== null) return settled;
  if (requestedPages != null && documentWords != null && documentWords < requestedPages * WORDS_PER_DRAFT_PAGE) {
    return finish(incompleteDocumentAnswer(notices, requestedPages, documentWords, documentWordCountExact));
  }
  const trailing = stripSpeakerLabel(finalText, speakerLabels).trim();
  if (trailing && !echoesEarlierAnswer(trailing, options.conversation, speakerLabels)) return finish(verified(trailing));
  // The board changed and the model never got to say so. Two cases, two sentences: the
  // loop ran out of steps mid-work (a build that needs another turn to finish), or it
  // simply ended on a tool call.
  //
  // `loop.exhausted` alone is NOT the discriminator, and reading it as one is a
  // regression this line already shipped once. Exhausted means "the cap stopped the
  // model", which is equally true of a turn that authored everything it was asked for
  // on its LAST step — and `stepsExhausted` then tells a user holding a finished
  // website and its comparison document that the work is half-done and to say
  // "continue". `buildTurn` is the case the notice was written for and says so in its
  // own docstring (see MAX_CANVAS_BUILD_TURNS): a workspace is written one file per
  // step, so hitting the cap there really does mean a part-written app. Everywhere
  // else, a changed board at the cap is a delivered board.
  if (canvasChanged) return finish(loop.exhausted && buildTurn ? notices.stepsExhausted : notices.addedToCanvas);
  // From here down the string is a RUNTIME NOTICE, not something the model said. The
  // caller is told so it can record it as a failed turn instead of writing it into the
  // transcript as an assistant reply for the next turn to copy.
  // A tool that FAILED still outranks prose: the error names what blocked the turn and
  // what would clear it, which the model's own narration routinely gets wrong.
  if (lastToolError) {
    options.onUnanswered?.({ reason: 'tool-error', detail: lastToolError });
    return notices.toolError(lastToolError);
  }
  // Otherwise: an answer the model gave earlier in this turn is NOT a runtime notice, and
  // the fact that it never reached canvas_add_object does not make it worthless — for a
  // drafting request it IS the deliverable. Deliver it (still subject to the
  // unverified-creation check, which replaces an answer CLAIMING a canvas change nobody
  // made) rather than discarding the user's result in favour of a dead end.
  if (lastSpokenAnswer) {
    const checked = verified(lastSpokenAnswer);
    return finish(checked === lastSpokenAnswer ? notices.answeredWithoutCanvasChange(checked) : checked);
  }
  // A turn that ran out of PROVIDERS is not a turn that had nothing to say. Reporting it
  // as "no answer" blames the request, so the user rewrites a prompt that was fine.
  if (stalledStreams) {
    options.onUnanswered?.({ reason: 'no-answer', detail: 'provider-stalled' });
    return notices.providerStalled;
  }
  options.onUnanswered?.({ reason: mutationRequested ? 'command-not-executed' : 'no-answer' });
  return notices.noAnswer;
}
