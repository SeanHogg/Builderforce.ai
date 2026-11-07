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
 */

import {
  clientPinOf,
  fetchLocal,
  formatLocalModelRef,
  isLocalModelRef,
  localAuthHeaders,
  localChatCompletionsUrl,
  localFirstPlan,
  localRuntime,
  isServableLocalModel,
  normalizeLocalBaseUrl,
  parseLocalModelRef,
  rewriteToLocalUrl,
  runLocalFirst,
  type LocalEndpoint,
  type LocalFirstAccount,
  type LocalFirstAttempt,
  type LocalFirstAttemptRecord,
  type LocalFirstRunResult,
  type LocalFirstWorkload,
  type LocalRuntimeId,
  type LocalRuntimeProbe,
} from '@builderforce/local-inference';
import { isVolatileTail } from '@seanhogg/builderforce-memory/handoff';
import { estimateTokensFromChars, profileWorkload } from '@builderforce/workload';
import {
  RepetitionLoopError,
  StreamInterruptedError,
  streamChatCompletion,
  TransportError,
  type BrainTransport,
  type ChatCompletionMessage,
  type StreamChatOptions,
  type StreamChatResult,
  type StreamHandlers,
  readErrorBody,
} from './streamChatCompletion';
import { summarizeLocalFirstAttempt, type LocalFirstAttemptSummary } from './localFirstTraces';
import { BrainRequestError, NOT_SIGNED_IN, PROVIDER_AUTH_REQUIRED, brainRequestError } from './chatError';
import { hostOf } from './streamFailureDetail';
import { contextWindowOf } from './windowFit/modelWindow';

/** The `fetch` a host lends the local path (the global in every host by default). */
export type LocalFetch = (input: string, init: RequestInit) => Promise<Response>;

/** A Brain streaming fn — structurally `BrainStreamFn`, restated to keep this module
 *  off the run store's import graph. */
type StreamFn = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;

/** Read at CALL time so a harness that swaps the global is honoured. */
const globalFetch: LocalFetch = (input, init) => fetch(input, init);

/** A 403 body that says the CREDENTIAL was refused (as opposed to a plan, region or quota refusal). */
const AUTH_REFUSAL = /unauthori[sz]ed|unauthenticated|expired|token|credential|authenticat|\bapi[_ ]?key\b|\bkey\b/i;

function refusesCredential(body: unknown): boolean {
  const b = (body ?? {}) as { code?: unknown; error?: unknown; message?: unknown };
  const text = [b.code, typeof b.error === 'string' ? b.error : (b.error as { message?: unknown } | undefined)?.message, b.message]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
  return AUTH_REFUSAL.test(text);
}

/**
 * Maps a non-OK response from an account-backed runtime: a 401 (or a 403 whose body says the credential was refused)
 * names the provider to sign in to; every other status, a plan or region 403 included, maps as the gateway's do.
 */
function providerErrorMapper(provider: string, label: string): (res: Response) => Promise<Error> {
  return async (res) => {
    const body = await readErrorBody(res);
    const mapped = brainRequestError(res.status, body, res.statusText);
    if (res.status !== 401 && !(res.status === 403 && refusesCredential(body))) return mapped;
    return new BrainRequestError(`${label} rejected the sign-in (${res.status}). ${mapped.message}`, {
      status: res.status,
      code: PROVIDER_AUTH_REQUIRED,
      provider,
      providerLabel: label,
    });
  };
}

/**
 * The transport that points the shared streamer at a local runtime.
 *
 * `getToken` returns the endpoint's own credential or null. Null is the on-device case
 * and is load-bearing: the streamer omits `Authorization` for a null token, so a
 * signed-out client can still run a local turn.
 *
 * `failFast` is for a local-first attempt. The streamer re-sends a request whose
 * connection never opened for about half a minute (`retryOnConnectFailure` — right for
 * the gateway over a flaky network), but a localhost runtime that refuses the connection
 * is NOT running, and the cloud fallback is waiting. So the refusal is re-thrown as a
 * plain error — deliberately with NO `cause`, because the retry walks the cause chain
 * for a connect-failure code and would find it there.
 *
 * The body is the plain OpenAI one (`wire: 'openai'`): no gateway-only field reaches a
 * runtime. `runtime`, when known, lets the registry's `providerSampling` drop the
 * temperature for a provider that picks it per model (Kimi Code).
 */
export function localTransport(
  endpoint: LocalEndpoint,
  fetchImpl: LocalFetch = globalFetch,
  options: { failFast?: boolean; runtime?: LocalRuntimeId } = {},
): BrainTransport {
  const baseUrl = normalizeLocalBaseUrl(endpoint.baseUrl);
  const runtime = options.runtime ? localRuntime(options.runtime) : undefined;
  // Whether each request's credential lookup (`endpoint.credential`) settled: a lookup that never returns is the other
  // way a hosted call can sit silent, and the failure detail says which half it was. Per REQUEST (keyed by its abort
  // signal) because one transport serves concurrent calls and a shared flag would report another call's state.
  const credentialStates = new WeakMap<AbortSignal, 'resolved' | 'pending' | 'none'>();
  const stateOf = (signal: AbortSignal | null | undefined): 'resolved' | 'pending' | 'none' =>
    (signal ? credentialStates.get(signal) : undefined) ?? 'none';
  return {
    baseUrl,
    getToken: () => endpoint.token ?? null,
    wire: 'openai',
    ...(runtime?.providerSampling ? { providerSampling: true } : {}),
    // A hosted runtime reached directly (Kimi Code) is named in a silence error; an on-device engine keeps the neutral default.
    ...(runtime && !runtime.onDevice ? { destination: { label: runtime.label, host: hostOf(baseUrl) } } : {}),
    credentialState: (signal) => stateOf(signal),
    // A hosted runtime backed by the person's OWN account (registry `accountProvider`) that refuses the credential is a
    // PROVIDER sign-in problem; mapped to the generic 401 it would be read as a BuilderForce session error.
    ...(runtime?.accountProvider ? { mapError: providerErrorMapper(runtime.accountProvider, runtime.label) } : {}),
    fetch: async (input, init) => {
      const signal = init.signal ?? undefined;
      const mark = (state: 'resolved' | 'pending' | 'none'): void => { if (signal) credentialStates.set(signal, state); };
      mark(endpoint.credential ? 'pending' : 'none');
      const tracked: LocalEndpoint = endpoint.credential
        ? {
            ...endpoint,
            credential: async (stale) => {
              mark('pending');
              try { return await endpoint.credential!(stale); } finally { mark('resolved'); }
            },
          }
        : endpoint;
      try {
        return await fetchLocal(tracked, fetchImpl, rewriteToLocalUrl(input), init);
      } catch (e) {
        if (!options.failFast || init.signal?.aborted) throw e;
        throw new Error(`local_runtime_unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/**
 * Packs a call for the LOCAL model about to take it — a host builds one with brain-
 * embedded's `createHandoffFit` (the `@seanhogg/builderforce-memory/handoff` packer).
 * `contextTokens` is the target's window when known (its runtime's report, else the
 * shipped catalog row); a fit given no window returns the messages untouched.
 * `conversation` is the call's conversation (`StreamChatOptions.conversationKey`): a fit
 * that remembers its last pack keeps one per conversation, so two chats on one local
 * model never reuse each other's pack.
 */
export type LocalAttemptFit = (
  messages: ChatCompletionMessage[],
  target: { ref: string; contextTokens?: number; tools?: readonly unknown[]; maxTokens?: number; conversation?: number },
) => Promise<ChatCompletionMessage[]>;

/** A local model resolved to where it runs. */
interface LocalTarget {
  ref: string;
  provider: LocalRuntimeId;
  /** The bare id the runtime knows. */
  model: string;
  endpoint: LocalEndpoint;
}

/** The reachable runtime serving `ref`, from a probe. */
function probedTarget(ref: string, probes: readonly LocalRuntimeProbe[]): LocalTarget | null {
  for (const p of probes) {
    if (!p.reachable) continue;
    const m = p.models.find((x) => x.ref === ref && isServableLocalModel(x));
    if (m) return { ref, provider: p.provider, model: m.model, endpoint: p.endpoint };
  }
  return null;
}

/** The messages a local attempt sends: fitted to the target's window when a fit is lent. */
async function fittedFor(
  target: LocalTarget,
  opts: Omit<StreamChatOptions, 'transport'>,
  fit: LocalAttemptFit | undefined,
  probes: readonly LocalRuntimeProbe[],
): Promise<ChatCompletionMessage[]> {
  if (!fit) return opts.messages;
  const contextTokens = contextWindowOf(target.ref, { probes });
  return fit(opts.messages, {
    ref: target.ref,
    ...(contextTokens ? { contextTokens } : {}),
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.conversationKey !== undefined ? { conversation: opts.conversationKey } : {}),
  });
}

/** Stream one call on a local target, reported as its full ref. */
async function streamOnLocal(
  target: LocalTarget,
  opts: Omit<StreamChatOptions, 'transport'>,
  handlers: StreamHandlers,
  transport: BrainTransport,
  messages: ChatCompletionMessage[],
  picked: boolean,
): Promise<StreamChatResult> {
  // Whose account made the call is read off the runtime registry, never a runtime id: a HOSTED runtime reached from this
  // machine (Kimi Code) is the person's OWN account, while an on-device engine has no account at all - the reply chip then
  // says "on this device" from the ref itself (`runsOnDevice`). The stream's own `onModel` would name the bare model the
  // provider echoes (`k3`); the full ref is what the live row and the settled reply both carry.
  const account = localRuntime(target.provider).onDevice ? undefined : 'own';
  const named: StreamHandlers = handlers.onModel
    ? { ...handlers, onModel: () => handlers.onModel?.(target.ref, account) }
    : handlers;
  let served: StreamChatResult;
  try {
    // `picked`: the call names this model (a pin, a failover target) and is held to it; a plan attempt names none, so a
    // silence there is the plan's to route around, not a model the person picked.
    served = await streamChatCompletion({ ...opts, messages, model: target.model, modelStrict: opts.modelStrict || picked, transport }, named);
  } catch (e) {
    throw withModelRef(e, target.ref);
  }
  return { ...served, resolvedModel: target.ref, resolvedVendor: `local/${target.provider}`, ...(account ? { account } : {}) };
}

/** An interruption or transport failure re-reported under the full ref (`local/kimi-code/k3`), not the bare id the runtime echoes. */
function withModelRef(e: unknown, ref: string): unknown {
  if (e instanceof RepetitionLoopError || !(e instanceof StreamInterruptedError || e instanceof TransportError)) return e;
  if (e.model === ref) return e;
  const out = e instanceof StreamInterruptedError
    ? new StreamInterruptedError(e.message, ref, e.detail, { pinned: e.pinned })
    : new TransportError(e.message, ref, { cause: e.cause, unreachable: e.unreachable, pinned: e.pinned });
  out.name = e.name;
  if (e.stack) out.stack = e.stack;
  if (e instanceof StreamInterruptedError && e.cause !== undefined) (out as { cause?: unknown }).cause = e.cause;
  return out;
}

/** Where a pinned local stream may send a call that names a DIFFERENT model. */
export interface LocalStreamRoute {
  /** The pin's full `local/<runtime>/<model>` ref — reported as the serving model. */
  ref?: string;
  /** The runtimes as probed, so a failover to another local model finds its endpoint. */
  probes?: readonly LocalRuntimeProbe[];
  /** The gateway stream, so a failover to a cloud model reaches it (null signed out). */
  cloud?: StreamFn | null;
  /** Packs each call for the local model taking it. */
  fit?: LocalAttemptFit;
}

/**
 * The streaming fn for a PINNED local model — the local twin of a gateway stream. The
 * loop pins the full `local/<runtime>/<model>` ref, but the runtime knows only its bare
 * id, so `model` is overridden with it. Gateway-only fields (`strict`, `routingMode`,
 * `metadata`) ride through; the runtimes ignore them rather than reject them.
 *
 * A call that names a DIFFERENT model (a run-policy failover, a coder re-ask) goes where
 * that model runs — another probed local runtime, the pin's own runtime under another
 * id, or the gateway — instead of silently landing on the pin. Only a model with
 * nowhere to go (a cloud ref signed out, an unknown local ref) stays on the pin.
 */
export function createLocalStream(
  endpoint: LocalEndpoint,
  model: string,
  fetchImpl?: LocalFetch,
  route: LocalStreamRoute = {},
): StreamFn {
  const pin = parseLocalModelRef(route.ref);
  const transport = localTransport(endpoint, fetchImpl, pin ? { runtime: pin.provider } : {});
  const probes = route.probes ?? [];
  const pinned: LocalTarget | null = route.ref && pin ? { ref: route.ref, provider: pin.provider, model, endpoint } : null;
  return async (opts, handlers = {}) => {
    const asked = opts.model;
    // `clientPinOf`: the pick may name the pin in the gateway's spelling
    // (`direct/kimi-code/k3` for `local/kimi-code/k3`) — that IS the pin, not a model to
    // send to the gateway.
    const parsed = clientPinOf(asked);
    const isPin = !!pin && !!parsed && parsed.provider === pin.provider && parsed.model === model;
    if (asked && asked !== route.ref && asked !== model && !isPin) {
      if (parsed) {
        const ref = formatLocalModelRef(parsed.provider, parsed.model);
        const sameRuntime: LocalTarget | null = pin && parsed.provider === pin.provider
          ? { ref, provider: parsed.provider, model: parsed.model, endpoint }
          : null;
        const target = probedTarget(ref, probes) ?? sameRuntime;
        if (target) {
          const t = target.endpoint === endpoint ? transport : localTransport(target.endpoint, fetchImpl, { runtime: target.provider });
          const messages = await fittedFor(target, opts, route.fit, probes);
          return streamOnLocal(target, opts, committingHandlers(handlers, () => undefined, target.ref), t, messages, true);
        }
      } else if (route.cloud) {
        return route.cloud(opts, handlers);
      }
    }
    if (!pinned) return streamChatCompletion({ ...opts, model, transport }, handlers);
    const messages = await fittedFor(pinned, opts, route.fit, probes);
    return streamOnLocal(pinned, opts, committingHandlers(handlers, () => undefined, pinned.ref), transport, messages, true);
  };
}

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

/**
 * Forward a stream's handlers, marking the attempt COMMITTED on the first user-visible
 * output. For a local attempt the serving model is already known — the full local ref —
 * so it is reported up front (a runtime need not name its model in a header or chunk,
 * and the streamer's own `onModel` fires only when one does), and the streamer's later
 * report of the runtime's bare id is swallowed rather than overwriting the ref.
 */
function committingHandlers(handlers: StreamHandlers, commit: () => void, servedAs?: string): StreamHandlers {
  if (servedAs) handlers.onModel?.(servedAs, undefined);
  return {
    ...handlers,
    onTextDelta: (delta) => {
      commit();
      handlers.onTextDelta?.(delta);
    },
    onToolCallDelta: (index, partial) => {
      commit();
      handlers.onToolCallDelta?.(index, partial);
    },
    ...(servedAs ? { onModel: () => undefined } : {}),
  };
}

/**
 * The account pool's final error, honest about the accounts that were tried first: when
 * the gateway's strict BYO leg then fails with its own `BrainRequestError` ("no provider is
 * connected on this workspace"), the person is also told which account failed and why.
 * Status, code and the rest of the error's fields are preserved; any other error is
 * returned as it came (a Stop, a transport failure).
 */
function withFailedAccounts(e: unknown, failed: readonly LocalFirstAttemptRecord[]): unknown {
  if (!(e instanceof BrainRequestError) || failed.length === 0) return e;
  const prefix = failed
    .map((r) => `${r.attempt.kind === 'local' ? r.attempt.ref : 'account'} could not take this turn (${r.detail ?? r.outcome}). `)
    .join('');
  const out = new BrainRequestError(prefix + e.message, {
    status: e.status,
    ...(e.code ? { code: e.code } : {}),
    ...(e.reason ? { reason: e.reason } : {}),
    ...(e.unlock ? { unlock: e.unlock } : {}),
    ...(e.requiredPlan ? { requiredPlan: e.requiredPlan } : {}),
    ...(e.feature ? { feature: e.feature } : {}),
    ...(e.provider ? { provider: e.provider } : {}),
    ...(e.providerLabel ? { providerLabel: e.providerLabel } : {}),
  });
  if (e.stack) out.stack = e.stack;
  return out;
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
            return input.cloud!(routed, committingHandlers(handlers, commit));
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

/** The message shape a non-streaming local call puts on the wire — structural, because it
 *  only ever JSON-serializes it (hosts hold differently-typed message arrays). */
export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}

/**
 * A non-streaming completion against a local runtime (a summarizer, a scanner). Returns
 * the assistant text ('' when none) and throws on a non-OK response.
 */
export async function completeLocal(
  endpoint: LocalEndpoint,
  model: string,
  messages: readonly LocalChatMessage[],
  signal?: AbortSignal,
  fetchImpl: LocalFetch = globalFetch,
): Promise<string> {
  const res = await fetchLocal(endpoint, fetchImpl, localChatCompletionsUrl(endpoint.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...localAuthHeaders(endpoint) },
    body: JSON.stringify({ model, messages, stream: false }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const txt = await res.text().catch((e: unknown) => `(body unreadable: ${e instanceof Error ? e.message : String(e)})`);
    throw new Error(`local_complete_failed_${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
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
