/**
 * THE agent loop of the image surfaces — the Cloudflare Container (`server.mjs`) and the
 * GitHub Actions runner (`githubActionsRunner.ts`, which inlines this file).
 *
 * The model→tools→model skeleton is the shared kernel (`@builderforce/agent-loop`,
 * compiled into `./agentLoop.mjs` by `api/scripts/gen-agent-loop-bundle.mjs`): the same
 * step loop, failure-streak breaker and repetition-loop trim every other surface runs.
 * Both images used to hand-write it, with a 20-step ceiling the kernel retired — a run
 * stops when it finishes, when a human stops it or pauses it, or when its tools keep
 * failing, never because it worked for too long.
 *
 * What is image-specific is mapped onto the kernel's hooks here, ONCE for both images:
 *
 *   • the turn comes from the Worker's `llm` op, which owns the model choice (the run
 *     policy) — this file never names a model;
 *   • history the Worker COMPACTED is adopted as the live transcript;
 *   • STEERING (user follow-ups, and the Worker's stall re-prompts) keeps the run going:
 *     on a turn with no tool calls it is spliced in instead of finishing, and after a
 *     turn's tool results it overrides a `finish` in that same turn;
 *   • a tool result that reports `paused` (the run is parked on a human question) ends
 *     the loop at once, without running the turn's remaining calls;
 *   • a cancel the heartbeat observed stops the run before the next paid call.
 *
 * Each image keeps only what genuinely differs: how it talks to the Worker, how it runs
 * a tool (clone vs checkout), and its terminal op.
 */
import { runAgentLoop, openAiChatCodec, readOpenAiToolCalls } from './agentLoop.mjs';

/** What a remaining call of a paused turn reads as — it never ran. */
const PAUSED_SKIP = { ok: false, error: 'not run: the run paused on a question for a human' };

/**
 * Drive one image run to a stop.
 *
 * @param {object} io
 * @param {Array<Record<string, unknown>>} io.messages The live transcript, mutated in place.
 * @param {(messages: Array<Record<string, unknown>>) => Promise<any>} io.llm Post the `llm` op.
 * @param {(name: string, args: Record<string, unknown>, loop: object) => Promise<any>} io.execTool Run one tool.
 * @param {() => boolean} io.isCancelled Whether the heartbeat saw the run cancelled.
 * @param {((toolName: string, data: unknown) => string) | undefined} [io.toolResultPolicy]
 *   The per-result budget for tool rows (PRD C7, the shared tool-output policy). Omitted
 *   ⇒ plain JSON rows, as before — the Actions runner passes nothing.
 * @returns {Promise<{ output: string, cancelled: boolean, crashed: string | null, paused: boolean }>}
 */
export async function runImageLoop({ messages, llm, execTool, isCancelled, toolResultPolicy }) {
  let steering = [];
  let turnCallIds = [];
  let crashed = null;
  let cancelled = false;
  let paused = false;
  /** The run's output when a turn came back cancelled — the kernel would report the
   *  stop reason instead of what the model last said. */
  let outputAtCancel = null;

  /** Splice the pending steers in as user turns, once. */
  const applySteering = () => {
    for (const steer of steering) messages.push({ role: 'user', content: steer });
    steering = [];
  };

  const loop = await runAgentLoop({
    messages,
    codec: openAiChatCodec(toolResultPolicy ? { toolResultPolicy } : undefined),
    // No step cap: the kernel's failure-streak breaker is the only limit.
    budget: {},
    hooks: {
      isCancelled: () => isCancelled(),
      onNoToolCalls: (_ctx, turn) => {
        // A bare final answer ends the run — unless something steered it, in which case
        // the new direction is acted on instead of being dropped.
        if (steering.length === 0) return { action: 'finish' };
        if (turn.content) messages.push({ role: 'assistant', content: turn.content });
        applySteering();
        return { action: 'continue' };
      },
      afterDispatch: (_call, result) => (result.control && result.control.kind === 'ask_human'
        ? { skipRemaining: { data: PAUSED_SKIP } }
        : undefined),
      afterToolCalls: () => {
        // Steers land AFTER this turn's tool results so the agent reacts to them next
        // step, and a steer overrides a finish in the same turn: the user added work.
        if (paused || steering.length === 0) return undefined;
        applySteering();
        return { finished: false };
      },
    },
    ports: {
      complete: async (ctx) => {
        const turn = await llm(messages);
        // A gateway error is a FAILURE, not an orderly finish — the model produced no
        // turn. The image routes it to its `fail` channel, never to `finalize`.
        if (turn.error) {
          crashed = `gateway error: ${turn.error}`;
          return { failed: crashed };
        }
        if (turn.cancelled) {
          cancelled = true;
          outputAtCancel = ctx.output;
          return { failed: 'cancelled' };
        }
        // The Worker summarized old turns — adopt that as the loop state so the full
        // history is not re-sent (and re-summarized) next turn. Pairing-safe.
        if (Array.isArray(turn.compactedMessages)) {
          messages.length = 0;
          messages.push(...turn.compactedMessages);
        }
        steering = Array.isArray(turn.steering) ? turn.steering.filter((s) => typeof s === 'string' && s.trim()) : [];
        const toolCalls = readOpenAiToolCalls({ tool_calls: turn.toolCalls });
        turnCallIds = toolCalls.map((call) => call.id);
        return { content: typeof turn.content === 'string' ? turn.content : '', toolCalls };
      },
      dispatch: async (call, ctx) => {
        if (call.name === 'finish') {
          const summary = typeof call.args.summary === 'string' ? call.args.summary : '';
          return { data: { ok: true }, control: { kind: 'finish', summary } };
        }
        const result = await execTool(call.name, call.args, {
          messages, step: ctx.step, toolCallId: call.id, toolCallIds: turnCallIds,
        });
        // Parked on a human question: the Worker already froze the conversation and
        // paused the row, so nothing else may run or be spent.
        if (result && result.paused) {
          paused = true;
          return { data: result, control: { kind: 'ask_human', question: '' } };
        }
        return { data: result, isError: !!result && result.ok === false };
      },
    },
  });

  return { output: outputAtCancel ?? loop.output, cancelled: cancelled || loop.cancelled, crashed, paused };
}
