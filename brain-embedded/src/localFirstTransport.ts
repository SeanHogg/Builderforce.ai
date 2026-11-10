/**
 * The SHARED streamer pointed at a runtime on the user's own machine — pinned, or LOCAL
 * FIRST with failover to the cloud gateway.
 *
 * Every client that runs the Brain loop on the user's machine (the VS Code extension
 * host, the Chrome extension's service worker) drives the same `streamChatCompletion`,
 * so the binding of `@builderforce/local-inference` to it lives here, once: the URL
 * rewrite, the endpoint's own token, commit-on-first-delta, and the fail-fast that keeps
 * a dead localhost runtime from riding the gateway's connect-retry. Host-neutral: `fetch`
 * and the probed runtimes are injected; nothing here touches Node, `vscode` or `chrome`.
 *
 * All runtimes speak the OpenAI wire format, which is why the whole adaptation is a URL
 * rewrite plus the endpoint's token — the agent loop, tool-call protocol and error
 * mapping are exactly the ones a gateway turn uses.
 *
 * One concern per module; this one is the local-first PLAN (which calls go local, the
 * account pool, the failover run). The pieces it composes live beside it and are
 * re-exported here, so every caller keeps importing from this module:
 *   - `localTransport.ts`      — the transport + the non-streaming completion
 *   - `localCredentialState.ts` — per-request credential-lookup state
 *   - `localFirstErrors.ts`    — provider error mapping and error re-wrapping
 *   - `localTargetStream.ts`   — one call on a resolved local target; the pinned stream
 */

import {
  isLocalModelRef,
  localFirstPlan,
  runLocalFirst,
  type LocalFirstAccount,
  type LocalFirstAttempt,
  type LocalFirstAttemptRecord,
  type LocalFirstRunResult,
  type LocalFirstWorkload,
  type LocalRuntimeProbe,
} from '@builderforce/local-inference';
import { isVolatileTail } from '@seanhogg/builderforce-memory/handoff';
import { estimateTokensFromChars, profileWorkload } from '@builderforce/workload';
import type { ChatCompletionMessage, StreamChatOptions, StreamChatResult } from './streamChatCompletion';
import { summarizeLocalFirstAttempt, type LocalFirstAttemptSummary } from './localFirstTraces';
import { NOT_SIGNED_IN } from './chatError';
import { withFailedAccounts } from './localFirstErrors';
import { completeLocal, localTransport, type LocalChatMessage, type LocalFetch } from './localTransport';
import {
  committingHandlers,
  fittedFor,
  probedTarget,
  streamOnLocal,
  type LocalAttemptFit,
  type StreamFn,
} from './localTargetStream';

export { completeLocal, localTransport, type LocalChatMessage, type LocalFetch } from './localTransport';
export { createLocalStream, type LocalAttemptFit, type LocalStreamRoute } from './localTargetStream';

/**
 * Read a call into what the local-first plan needs, through THE workload profile — so a
 * client sizes a call exactly the way the gateway and the model router do.
 */
export function localFirstWorkload(call: {
  messages: readonly unknown[];
  tools?: readonly unknown[];
  role?: string;
  maxTokens?: number;
}): LocalFirstWorkload {
  const chars = JSON.stringify(call.messages).length + (call.tools ? JSON.stringify(call.tools).length : 0);
  return profileWorkload({
    role: call.role,
    hasTools: (call.tools?.length ?? 0) > 0,
    inputTokens: estimateTokensFromChars(chars),
    ...(call.maxTokens ? { maxOutputTokens: call.maxTokens } : {}),
  });
}

/**
 * Whether a call is OPEN to local-first. Any model choice — an explicit pick, a
 * project's or role's pin, a configured default — names what the user wants and wins
 * outright, and so does an explicit "use my connected accounts" (`byo_pool`); only "let
 * the gateway route" may be served on this device first. The ONE statement of the rule:
 * the editor's route and the web app's stream both read it.
 *
 * Device runtimes stay out of `byo_pool` here. The pool's one exception is not a device
 * model: the connected ACCOUNTS a host calls itself (Kimi) are tried before the gateway's
 * pool, with no probes (see {@link createLocalFirstStream}).
 */
export function localFirstApplies(call: { model?: string; routingMode?: 'auto' | 'byo_pool'; role?: string }): boolean {
  // A UTILITY call (the summary stamps it) is mechanical compaction, not the person's
  // turn: the device may take it first whatever model the conversation is pinned to
  // (PRD 42 · C2). Everything else keeps the rule above.
  return call.role === UTILITY_ROLE || (!call.model && (call.routingMode ?? 'auto') === 'auto');
}

/** The `role` a silent utility completion (a summary) carries on its request. */
export const UTILITY_ROLE = 'utility';

/**
 * Whether a call is "use my connected accounts": the BYO pool with no model named. The ONE
 * statement of it — the stream and the host's routing step both read it; with accounts the
 * pool is those first, then the gateway's pool.
 */
export function isAccountPoolCall(call: { model?: string; routingMode?: 'auto' | 'byo_pool' }): boolean {
  return !call.model && call.routingMode === 'byo_pool';
}

/** What {@link createLocalFirstStream} needs from its host. */
export interface LocalFirstStreamInput {
  /** The runtimes as probed WITH capabilities (`createLocalRuntimeProber({ capabilities: true })`). */
  probes: readonly LocalRuntimeProbe[];
  /** Connected accounts this host calls itself (Kimi), tried after the device and before
   *  the cloud — Hybrid Auto, and "use my connected accounts" (`byo_pool`, device excluded)
   *  in Hybrid and Specific (`createHostModelStream`). */
  accounts?: readonly LocalFirstAccount[];
  /** The gateway stream, or null when signed out (local-only). */
  cloud: StreamFn | null;
  /** Lent to the local attempts; the global `fetch` by default. */
  fetch?: LocalFetch;
  /** Each settled attempt, as it settles — a host's log hook. The same attempts also
   *  ride on the result as `localFirst` for the run's trace. */
  onAttempt?: (record: LocalFirstAttemptRecord) => void;
  /**
   * Packs the call for each LOCAL attempt's window; the cloud attempt keeps the original
   * messages. With a fit, a local model is planned on the call's irreducible core — the
   * system message(s) + the latest user turn + tools — rather than its whole transcript,
   * since the fit is what makes the rest fit.
   */
  fit?: LocalAttemptFit;
  /**
   * The sentinel thrown when nothing can serve a call — `not_signed_in` (the default) or,
   * for a person sign-in would not help (Local only, or signed in with the cloud route
   * unavailable), `no_local_model`. `createHostModelStream` decides which.
   */
  noModel?: string;
  /**
   * Consulted once per call with the plan, before any attempt runs; returns the plan to
   * run. Hybrid's `run.local-success` predictor drops the local attempts here when it is
   * confident they would fail (`createHostModelStream`). Absent = the plan as made.
   */
  gate?: (plan: LocalFirstAttempt[], call: Omit<StreamChatOptions, 'transport'>) => Promise<LocalFirstAttempt[]>;
}

/** What no fit can drop: the system message(s) and the latest user turn — the request,
 *  never the per-turn volatile tail that rides after it. */
function coreMessages(messages: readonly ChatCompletionMessage[]): ChatCompletionMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user' && !isVolatileTail(m));
  return lastUser ? [...system, lastUser] : system;
}

/** An answer counts only when it says something or calls something. */
const answered = (r: StreamChatResult): boolean => r.text.trim().length > 0 || r.toolCalls.length > 0;

/**
 * LOCAL FIRST, failover to the gateway — one streaming fn the agent loop drives exactly
 * like the gateway's.
 *
 * The plan is made PER CALL, because what a call needs is only known then: a tool turn
 * goes only to a model whose runtime says it can take tools, so one run can answer its
 * plain turns locally and hand its tool turns to the cloud. A local attempt that fails
 * before the user saw any output (runtime down, HTTP error, empty answer) falls over
 * invisibly; one that already streamed owns the turn; a Stop is never failed over.
 *
 * The served attempt shows as `resolvedModel` (`local/<runtime>/<model>` for a local
 * answer) and every attempt rides on `result.localFirst`, from which the run loop
 * records `llm.local_fallback`. Signed out with nothing local that fits, it throws
 * `not_signed_in` — the contract a gateway route without a credential already has.
 */
export function createLocalFirstStream(input: LocalFirstStreamInput): StreamFn {
  return async (opts, handlers = {}) => {
    // A call that is not "let the gateway route" (`localFirstApplies` — this is the ONE
    // place that reads it for a stream) goes where it names: a call naming a model (a
    // run-policy failover, a coder re-ask) to that model's local runtime when probed,
    // else the gateway; an explicit `byo_pool` to the gateway. Never to whichever local
    // model the plan would have tried first.
    //
    // The ONE exception is the account pool: "use my connected accounts" (`byo_pool`, no
    // model) with accounts this host calls itself (Kimi) tries THOSE first, then the
    // gateway's pool (the call keeps `routingMode: 'byo_pool'`, so the gateway stays strict).
    // Device runtimes are never part of it (`probes: []`) and neither is the free pool.
    const accountPool = isAccountPoolCall(opts) && !!input.accounts?.length;
    if (!localFirstApplies(opts) && !accountPool) {
      if (!opts.model || !isLocalModelRef(opts.model)) {
        if (!input.cloud) throw new Error(input.noModel ?? NOT_SIGNED_IN);
        return input.cloud(opts, handlers);
      }
      const local = probedTarget(opts.model, input.probes);
      if (local) {
        const transport = localTransport(local.endpoint, input.fetch, { runtime: local.provider });
        const messages = await fittedFor(local, opts, input.fit, input.probes);
        return streamOnLocal(local, opts, committingHandlers(handlers, () => undefined, local.ref), transport, messages, true);
      }
    }
    // From here the call names no model (a local ref no probe serves cannot be sent
    // anywhere by name, so it is dropped): the plan routes it.
    const routed: Omit<StreamChatOptions, 'transport'> = opts.model ? { ...opts, model: undefined } : opts;
    // The device plan never sees a model name, but the cloud leg of a UTILITY call goes to the
    // run's model exactly as before (not gateway Auto): a non-local model stays on it.
    const cloudOpts = opts.model && !isLocalModelRef(opts.model) ? opts : routed;
    const probes = accountPool ? [] : input.probes;
    const failedAccounts: LocalFirstAttemptRecord[] = [];
    const planned = localFirstPlan({
      probes,
      ...(input.accounts?.length ? { accounts: input.accounts } : {}),
      workload: localFirstWorkload(input.fit ? { ...routed, messages: coreMessages(routed.messages) } : routed),
      cloud: input.cloud ? {} : null,
    });
    const plan = input.gate ? await input.gate(planned, routed) : planned;
    if (plan.length === 0) throw new Error(input.noModel ?? NOT_SIGNED_IN);
    const onAttempt = (record: LocalFirstAttemptRecord): void => {
      if (accountPool && record.outcome !== 'served' && record.attempt.kind === 'local') failedAccounts.push(record);
      input.onAttempt?.(record);
    };
    // Only an error the CLOUD attempt threw is re-worded with the accounts that failed first;
    // an account's own final error already says why it failed.
    let cloudStarted = false;
    let ran: LocalFirstRunResult<StreamChatResult>;
    try {
      ran = await runLocalFirst(
        plan,
        async (attempt, commit) => {
          if (attempt.kind === 'cloud') {
            cloudStarted = true;
            return input.cloud!(cloudOpts, committingHandlers(handlers, commit));
          }
          const transport = localTransport(attempt.endpoint, input.fetch, { failFast: true, runtime: attempt.provider });
          const messages = await fittedFor(attempt, routed, input.fit, probes);
          return streamOnLocal(attempt, routed, committingHandlers(handlers, commit, attempt.ref), transport, messages, false);
        },
        { signal: opts.signal, accept: answered, onAttempt },
      );
    } catch (e) {
      throw accountPool && cloudStarted ? withFailedAccounts(e, failedAccounts) : e;
    }
    const { result, attempts } = ran;
    const summaries: LocalFirstAttemptSummary[] = attempts.map(summarizeLocalFirstAttempt);
    return { ...result, localFirst: summaries };
  };
}

/**
 * LOCAL FIRST for a non-streaming completion — the twin of {@link createLocalFirstStream}.
 * Nothing streams, so nothing commits: any local failure or empty answer falls over to
 * `cloud`, the host's own gateway completion (null when signed out). Throws
 * `not_signed_in` when nothing local fits and there is no cloud.
 */
export async function completeLocalFirst(input: {
  probes: readonly LocalRuntimeProbe[];
  messages: readonly LocalChatMessage[];
  cloud: (() => Promise<string>) | null;
  signal?: AbortSignal;
  fetch?: LocalFetch;
  onAttempt?: (record: LocalFirstAttemptRecord) => void;
  /** As {@link LocalFirstStreamInput.noModel}. */
  noModel?: string;
}): Promise<string> {
  const plan = localFirstPlan({
    probes: input.probes,
    workload: localFirstWorkload({ messages: input.messages }),
    cloud: input.cloud ? {} : null,
  });
  if (plan.length === 0) throw new Error(input.noModel ?? NOT_SIGNED_IN);
  const { result } = await runLocalFirst(
    plan,
    (attempt) =>
      attempt.kind === 'cloud'
        ? input.cloud!()
        : completeLocal(attempt.endpoint, attempt.model, input.messages, input.signal, input.fetch),
    {
      ...(input.signal ? { signal: input.signal } : {}),
      accept: (text) => text.trim().length > 0,
      ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
    },
  );
  return result;
}
