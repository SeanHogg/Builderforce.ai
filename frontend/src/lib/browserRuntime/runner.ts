/**
 * Browser agent runner — the portable, transport-injected agent loop that runs
 * INSIDE the browser tab (the PWA / WebContainer). It claims a pending `browser`
 * dispatch from the platform, runs the agent step against the user's OWN model
 * (the LLM call routes through the BuilderForce gateway), and reports the
 * terminal result — which drives autonomous swimlane advancement server-side.
 *
 * Pure orchestration with an injected {@link BrowserRuntimeTransport}; the
 * concrete transport (transport.ts) is backed by the API client. The transport
 * boundary is the only thing that touches the network.
 */

export interface ClaimedDispatch {
  dispatchId: string;
  /** The agent's own model, e.g. 'anthropic/claude-3-haiku'. */
  model: string | null;
  role: string;
  input: string | null;
  taskId: number | null;
}

export interface ModelCall {
  model: string;
  prompt: string;
}

export interface BrowserRuntimeTransport {
  /** Claim the next pending browser dispatch for this worker, or null if none. */
  claim(): Promise<ClaimedDispatch | null>;
  /** Run one model completion through the gateway with the agent's own model. */
  callModel(call: ModelCall): Promise<string>;
  /** Report the terminal result; the server advances the ticket from here. */
  report(
    dispatchId: string,
    result: { status: 'completed' | 'failed'; output?: string; error?: string },
  ): Promise<void>;
}

export type RunOutcome = 'idle' | 'completed' | 'failed';

/** Default model used when an assignment did not pin one. */
export const DEFAULT_BROWSER_MODEL = 'anthropic/claude-3-haiku';

/**
 * Claim and run exactly one dispatch. Returns:
 *  - 'idle'      — nothing to claim
 *  - 'completed' — the agent produced output and reported success
 *  - 'failed'    — the agent step threw; reported as failed (never silently dropped)
 */
export async function runOnce(transport: BrowserRuntimeTransport): Promise<RunOutcome> {
  const dispatch = await transport.claim();
  if (!dispatch) return 'idle';

  const model = (dispatch.model ?? '').trim() || DEFAULT_BROWSER_MODEL;
  const prompt = buildPrompt(dispatch);

  try {
    const output = await transport.callModel({ model, prompt });
    await transport.report(dispatch.dispatchId, { status: 'completed', output });
    return 'completed';
  } catch (err) {
    await transport.report(dispatch.dispatchId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }
}

/**
 * Drain the queue: keep claiming + running until `idle` (no more work) or until
 * `maxIterations` is hit (a safety bound so a runaway queue can't spin forever).
 * Returns the per-run outcomes in order.
 */
export async function runLoop(
  transport: BrowserRuntimeTransport,
  opts: { maxIterations?: number } = {},
): Promise<RunOutcome[]> {
  const max = opts.maxIterations ?? 100;
  const outcomes: RunOutcome[] = [];
  for (let i = 0; i < max; i++) {
    const outcome = await runOnce(transport);
    outcomes.push(outcome);
    if (outcome === 'idle') break;
  }
  return outcomes;
}

/** Compose the agent's task prompt from the dispatch. */
export function buildPrompt(dispatch: ClaimedDispatch): string {
  const header = `You are the "${dispatch.role}" agent. Complete the following task and return your result.`;
  const body = (dispatch.input ?? '').trim() || 'No task description was provided.';
  return `${header}\n\n${body}`;
}
