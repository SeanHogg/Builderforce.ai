import type { RunPolicy, RunPorts, RunTask } from '@builderforce/agent-run';
import type { InferenceMode } from '@builderforce/local-first';
import type { CanvasAiOptions, CanvasRun } from '@/lib/canvasAiRun';
import { CANVAS_BUILD_RESPONSE_TOKENS, CANVAS_CONTEXT_TOKENS, canvasTurnShape } from '@/lib/canvasAiTurnBudget';
import { canvasDeliveryLedger } from '@/lib/canvasDelivery';
import { canvasModelTransport } from '@/lib/canvasModelPort';
import { canvasPlatformTools } from '@/lib/canvasPlatformTools';
import { toRunMessages } from '@/lib/canvasRunMessages';

/**
 * What a canvas turn hands the one agent (`@builderforce/agent-run`): the task, the policy
 * facts only the canvas knows, and the PORTS. An adapter builds ports and nothing else —
 * the loop, the stall ladder, the model hand-off, the tool selection and the result cap are
 * the agent's, and `entryPoint` is a telemetry label that nothing branches on.
 */

/** The task: the system blocks, the conversation and the request, exactly as the canvas assembled them. */
export function canvasRunTask(run: CanvasRun): RunTask {
  const { options } = run;
  const transcript = toRunMessages(run.messages);
  // The conversation before this request rides in the transcript; the TASK is the request
  // itself — the last user row — and compaction pins it, never an older message.
  const request = transcript.map((row) => row.role).lastIndexOf('user');
  if (request >= 0) transcript[request] = { ...transcript[request]!, task: true };
  return {
    prompt: options.prompt,
    transcript,
    dispatch: { source: 'chat' },
    ...(options.projectId != null ? { projectId: options.projectId } : {}),
  };
}

/**
 * The policy. One canvas turn is one logical agent turn, so its continuations stay on the
 * model that began it (a LOCK — a preference, not a strict pin: the gateway may still
 * substitute when the provider becomes unavailable) instead of asking Auto to reroute
 * every tool result. A model that will not act hands the turn to one that already emitted
 * valid tool calls in it, pinned strictly; models the session already proved will not
 * execute a command are routed around from the first request. No step cap, and the only
 * token figure is the context ceiling compaction reads (`CANVAS_CONTEXT_TOKENS`): a turn
 * stops when the model finishes, the user cancels, or the kernel's consecutive-tool-failure
 * breaker trips.
 *
 * The compaction reserve is the largest reply this turn can ask for (the build ceiling,
 * raised to the composer's Effort — Thorough asks for more), so a transcript that fits is
 * always left room for the reply the wire request will actually make.
 */
export function canvasRunPolicy(options: CanvasAiOptions, inference: InferenceMode): RunPolicy {
  return {
    entryPoint: 'canvas',
    toolScope: 'canvas',
    role: 'canvas',
    levers: [],
    budgets: { tokens: CANVAS_CONTEXT_TOKENS, reserveTokens: canvasTurnShape(CANVAS_BUILD_RESPONSE_TOKENS, options.runShaping).maxTokens },
    ...(options.model ? { pinnedModel: options.model } : {}),
    inference,
    verify: 'none',
    approvalGates: [],
    delegation: { requested: false, readsBeforeNudge: 6 },
    modelOptions: {
      strictPin: options.modelStrict,
      lockAfterFirstSuccess: true,
      preferProvenFailover: true,
      strictFailover: true,
      excludeModels: options.disabledModels ?? [],
    },
  };
}

/**
 * The ports. The model is the Brain's own stream; the board's tools are the platform; what
 * the turn still owes is the ledger. A canvas turn keeps no state between invocations, asks
 * no person through the run (a mutating tenant tool is confirmed in the app, inside the
 * tool), has no steering queue and reads its context before the run starts.
 */
export function canvasRunPorts(run: CanvasRun): RunPorts {
  return {
    model: canvasModelTransport(run),
    capabilities: { capabilities: new Set() },
    platform: canvasPlatformTools(run),
    delivery: canvasDeliveryLedger(run),
    store: { load: () => undefined, save: () => undefined },
    // The typed trace has no reader here. The run's uniform outcome row (§8.2, entryPoint
    // `canvas`) goes to the host's `onOutcome` port, which owns the network (no I/O in here).
    events: { emit: () => undefined, outcome: (row) => run.options.onOutcome?.(row) },
    human: { ask: async () => ({ kind: 'paused' }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
}
