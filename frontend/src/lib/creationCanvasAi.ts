import {
  fetchMcpToolEntries,
  mcpActionsFrom,
  resolveBrainStream,
  formatEvermindMemoryBlock,
  type BrainAction,
} from '@seanhogg/builderforce-brain-embedded';
import { brainConfig } from '@/lib/brain/runtime';
import { guestBrainConfig } from '@/lib/brain/guestRuntime';
import { webInferenceModeNow } from '@/lib/localFirst/webInferenceMode';
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
import { CanvasRunAbortedError } from '@/lib/canvasAiErrors';
import { composeTurnTail, documentShortfallAnswer } from '@/lib/canvasAiTurnTail';
import { learnFromCanvasAnswer, recallCanvasMemory } from '@/lib/canvasAiEvermind';
import type { CanvasAiOptions, CanvasRun } from '@/lib/canvasAiRun';
import { canvasRunPolicy, canvasRunPorts, canvasRunTask } from '@/lib/canvasRunPorts';

/**
 * Run one canvas turn on the one agent (`@builderforce/agent-run`) over the active canvas
 * and the shared MCP catalog.
 *
 * This is the CALL SITE: it assembles the turn's prompt and the board's tools, hands them
 * to `runAgent` as ports (`canvasRunPorts.ts`), and composes the answer the user reads from
 * what the run left on the board. The loop, the stall ladder, the model hand-off and the
 * tool selection are the agent's.
 *
 * No step cap — the same budget Rovr and the VSIX pass. A turn stops when the model
 * finishes, the user cancels, or the kernel's consecutive-tool-failure breaker trips. A
 * step ceiling is what cut a Stripe checkout off after 16 tool calls.
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
  //
  // NO MINT ON OPEN. An anonymous board (`persistence: 'local'`) defaults to Local only:
  // its turns run on this device's model with no API call at all, and with no model
  // here the stream fails `no_local_model` — the shared remedy (download a model /
  // switch to Hybrid), never a dead panel. The guest token is minted by the guest
  // transport the first time a HYBRID turn reaches the gateway (`guestRuntime`), so
  // nothing here asks for one up front.
  const localOnly = webInferenceModeNow() === 'local-only';
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
  // Their catalogue is a platform read, so under Local only they are skipped (no fetch).
  const careerActions = options.persistence === 'server' || localOnly ? [] : await loadGuestCareerActions();
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
    changedFiles: new Set<string>(),
    finalText: '',
    canvasChanged: false,
    abandonedMidTurn: false,
    narrowSearches: 0,
    lastToolError: '',
    lastSpokenAnswer: '',
    providerFailures: 0,
    documentWords: requestedPages == null ? null : documentWordsInSnapshot(options.canvasSnapshot),
    documentWordCountExact: false,
    workspaceTurn: false,
    buildTurn: false,
    buildAuthored: false,
    truncatedOnce: false,
    lastFinishReason: null,
    loopKept: '',
    fatal: null,
  };
  // ── THE run ─────────────────────────────────────────────────────────────────
  // The model→tools→model skeleton lives ONCE in `@builderforce/agent-loop`, driven by the
  // one agent (`@builderforce/agent-run`) that every entry point shares. The canvas's own
  // concerns are ports: the model transport (`canvasModelPort.ts`), the board's tools
  // (`canvasPlatformTools.ts`) and what the turn still owes (`canvasDelivery.ts`).
  // Nothing here iterates.
  // A dynamic import: the bundler splits the agent (its policy suite and the shared tool
  // registry) into its own chunk, fetched when the first turn runs; opening a board does not
  // wait on it. Everything else this module takes from the agent is a type.
  const { runAgent } = await import('@builderforce/agent-run');
  const outcome = await runAgent({
    task: canvasRunTask(run),
    policy: canvasRunPolicy(options, webInferenceModeNow()),
    ports: canvasRunPorts(run),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  // The user pressed Stop between round-trips (a stop mid-stream or mid-tool throws
  // on its own): typed, so the surface records "you stopped this", not a failure.
  throwIfStopped();
  // A provider error the policy does not route around (a refusal) surfaces as it is.
  if (run.fatal) throw run.fatal;
  if (outcome.kind === 'finished') return finish(outcome.output);
  // The run stopped without an answer of its own. Nothing the model said in flight is the
  // answer — except what a LOOPING model said before it looped, delivered when no other
  // model could take over.
  run.finalText = run.loopKept;
  if (run.loopKept) options.onText?.(run.finalText);
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
    // A canvas turn has no step cap, so no step notice: a failure-streak stop must not be
    // reported as "I used every step this turn allows".
    stepsExhausted: false,
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
