import {
  fetchMcpToolEntries,
  mcpActionsFrom,
  resolveBrainStream,
  formatEvermindMemoryBlock,
  type BrainAction,
  type ChatCompletionMessage,
} from '@seanhogg/builderforce-brain-embedded';
import { brainConfig } from '@/lib/brain/runtime';
import { guestBrainConfig } from '@/lib/brain/guestRuntime';
import { ensureGuestToken } from '@/lib/guestRoomApi';
import { GUEST_RESEARCH_ACTIONS } from '@/lib/guestResearchActions';
import { loadGuestCareerActions } from '@/lib/guestCareerActions';
import { conversationSpeakerLabels, echoesEarlierAnswer, stripSpeakerLabel } from '@/lib/canvasTranscript';
import {
  documentWordsInSnapshot,
  requestedPagesForTurn,
  requestsCanvasMutation,
  snapshotHasTabularRows,
  unverifiedCreationClaim,
} from '@/lib/canvasTurnOutcome';
import { canvasSystemMessages, promptNamedTools } from '@/lib/canvasAiSystemPrompt';
import { CanvasRunAbortedError, GuestAiUnavailableError } from '@/lib/canvasAiErrors';
import { MALFORMED_TOOL_CALL_DIRECTIVE, TRUNCATED_ROUND_DIRECTIVE } from '@/lib/canvasAiTurnBudget';
import { runAgentLoop, openAiChatCodec } from '@builderforce/agent-loop';
import { initialRunPolicy } from '@builderforce/run-policy';
import { composeTurnTail, documentShortfallAnswer } from '@/lib/canvasAiTurnTail';
import { learnFromCanvasAnswer, recallCanvasMemory } from '@/lib/canvasAiEvermind';
import type { CanvasAiOptions, CanvasRun } from '@/lib/canvasAiRun';
import { canvasModelPort } from '@/lib/canvasModelPort';
import { canvasToolPort } from '@/lib/canvasToolPort';
import { canvasNoToolCallsHook } from '@/lib/canvasNoToolCalls';

/**
 * Run the canvas agent loop over the active canvas and shared MCP catalog.
 *
 * No step cap — the same budget Rovr and the VSIX pass (`runLoop.ts`: `budget: {}`).
 * A turn stops when the model finishes, the user cancels, or the kernel's
 * consecutive-tool-failure breaker trips. A step ceiling is what cut a Stripe
 * checkout off after 16 tool calls.
 */
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
  // The list is a ROUTING HINT now, not a veto: it seeds the run policy's exclusions
  // (below), which ride the request as `excludeModels` — honoured by the gateway only
  // while another candidate remains. Worst case the same model answers again — strictly
  // better than refusing to answer at all.
  if (options.persistence === 'local' && !(await ensureGuestToken())) {
    throw new GuestAiUnavailableError();
  }
  const config = options.persistence === 'server' ? brainConfig : guestBrainConfig;
  const transport = config.transport;
  // Where each round trip runs is the config's — the Brain's own stream, so an unpinned,
  // tool-free turn may be served on the browser's model first and anything else (a pin,
  // `byo_pool`, a tool turn) reaches the gateway exactly as before.
  const stream = resolveBrainStream(config);
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
  const recalled = await recallCanvasMemory(options.evermind, options.prompt, options.onTrace);
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
  /** Settle on `answer`, handing it to Evermind's best-effort learn path first. */
  const finish = async (answer: string): Promise<string> => {
    await learnFromCanvasAnswer(options.evermind, recalled, answer, options.prompt, options.onTrace);
    return answer;
  };
  const notices = options.notices;
  const mutationRequested = !options.participant && requestsCanvasMutation(options.prompt);
  const hasTabularData = snapshotHasTabularRows(options.canvasSnapshot);
  const requestedPages = requestedPagesForTurn(options);
  // THE model hand-off policy (`@builderforce/run-policy`), shared with every other agent
  // loop. One canvas turn is one logical agent turn, so its continuations stay on the
  // model that began it (a LOCK — a preference, not a strict pin: the gateway may still
  // substitute when the provider becomes unavailable), instead of asking Auto to reroute
  // every tool result (which once moved research from MiniMax to Gemini just before the
  // required Canvas write). A model that will not act hands the turn to one that already
  // emitted valid tool calls in it, pinned strictly; models the session already proved
  // will not execute a command are routed around from the first request.
  const run: CanvasRun = {
    options,
    notices,
    messages,
    stream,
    guestTurnId,
    actions,
    byName,
    mutationRequested,
    requiredTools: promptNamedTools(messages),
    speakerLabels: conversationSpeakerLabels(options.conversation, [options.participant?.name]),
    requestedPages,
    // An informational question is allowed to mention documents, reports, charts,
    // and other artifact nouns. Running the mutation-claim detector on every answer
    // turned ordinary replies such as "here is the standard document format" into
    // "I described a canvas change but did not make one." Only enforce this contract
    // when the user's request actually asked Canvas to create or update something.
    verified: (answer: string): string =>
      unverifiedCreationClaim(notices, answer, run.canvasChanged, hasTabularData, mutationRequested) ?? answer,
    finish,
    throwIfStopped,
    toolsUsedThisTurn: new Set<string>(),
    changedFiles: new Set<string>(),
    // Omitted `stepCap` is unbounded (`stepCap ?? Infinity` in the kernel). The
    // authoring countdown arms only when a finite cap is set; a prose recovery
    // still arms authoring on its own.
    budget: {},
    finalText: '',
    canvasChanged: false,
    executiveRequestRecoveryUsed: false,
    mutationRecoveries: 0,
    buildAuthoringRecoveries: 0,
    degenerateAnswerRecoveryUsed: false,
    interruptedTurnRecoveries: 0,
    abandonedMidTurn: false,
    authoringDirectiveIssued: false,
    narrowSearches: 0,
    lastToolError: '',
    lastSpokenAnswer: '',
    policy: initialRunPolicy({
      pinnedModel: options.model,
      strictPin: options.modelStrict,
      lockAfterFirstSuccess: true,
      preferProvenFailover: true,
      strictFailover: true,
      excludeModels: options.disabledModels ?? [],
    }),
    providerFailures: 0,
    documentWords: requestedPages == null ? null : documentWordsInSnapshot(options.canvasSnapshot),
    documentWordCountExact: false,
    settled: null,
    authoringOnly: false,
    lastTurnInterruption: null,
    discardedCallThisRound: false,
    workspaceTurn: false,
    buildTurn: false,
    buildAuthored: false,
    truncatedOnce: false,
  };
  // ── THE loop ────────────────────────────────────────────────────────────────
  // The model→tools→model skeleton lives ONCE in `@builderforce/agent-loop` (the same
  // kernel the cloud engine, the Brain and the on-prem runtime drive). The canvas's own
  // concerns — the reserved authoring phase, the stalled-provider and interruption
  // ladders, the mutation escalation, the confirm gate, the completion diagnostics —
  // are hooks and ports closing over this turn's state (`canvasModelPort.ts`,
  // `canvasToolPort.ts`, `canvasNoToolCalls.ts`). Nothing here iterates.
  const loop = await runAgentLoop<ChatCompletionMessage>({
    messages,
    codec: openAiChatCodec<ChatCompletionMessage>(),
    signal: options.signal,
    budget: run.budget,
    ports: { complete: canvasModelPort(run), dispatch: canvasToolPort(run) },
    hooks: {
      // A stopped run must not START another tool. One already in flight is left to
      // settle (its own transport owns the cancellation); nothing after it runs.
      beforeDispatch: () => { throwIfStopped(); return undefined; },
      afterToolCalls: () => {
        run.finalText = '';
        // The complete calls in a cut-off round already ran and the discarded one got
        // its own result above; say once, for the round, how to stop it recurring.
        if (run.discardedCallThisRound) {
          run.discardedCallThisRound = false;
          messages.push({
            role: 'system',
            content: run.lastTurnInterruption === 'truncated' ? TRUNCATED_ROUND_DIRECTIVE : MALFORMED_TOOL_CALL_DIRECTIVE,
          });
        }
        return undefined;
      },
      onNoToolCalls: canvasNoToolCallsHook(run),
    },
  });
  // The user pressed Stop between round-trips (a stop mid-stream or mid-tool throws
  // on its own): typed, so the surface records "you stopped this", not a failure.
  if (loop.cancelled) throw new CanvasRunAbortedError();
  if (run.settled !== null) return run.settled;
  const { speakerLabels } = run;
  const trailing = stripSpeakerLabel(run.finalText, speakerLabels).trim();
  const tail = composeTurnTail({
    notices,
    documentShortfall: documentShortfallAnswer(notices, requestedPages, run.documentWords, run.documentWordCountExact),
    trailingAnswer: trailing && !echoesEarlierAnswer(trailing, options.conversation, speakerLabels) ? trailing : '',
    lastSpokenAnswer: run.lastSpokenAnswer,
    lastToolError: run.lastToolError,
    canvasChanged: run.canvasChanged,
    abandonedMidTurn: run.abandonedMidTurn,
    providerFailures: run.providerFailures,
    // Only a step cap produces this notice (`exhaustedBy: 'steps'`). An empty budget
    // never exhausts that way; a failure-streak stop must not be reported as
    // "I used every step this turn allows".
    stepsExhausted: loop.exhaustedBy === 'steps',
    workspaceTurn: run.workspaceTurn,
    buildTurn: run.buildTurn,
    buildAuthored: run.buildAuthored,
    changedFiles: [...run.changedFiles],
    mutationRequested,
    verify: run.verified,
  });
  // A runtime notice is reported first, so the surface keeps it out of the transcript.
  if (tail.unanswered) options.onUnanswered?.(tail.unanswered);
  return tail.learn ? finish(tail.answer) : tail.answer;
}
