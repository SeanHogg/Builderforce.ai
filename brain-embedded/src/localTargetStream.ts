/**
 * Streaming ONE call on a resolved local target, and the PINNED local stream built on it —
 * one concern, split out of `localFirstTransport.ts` (which re-exports the public names).
 */

import {
  clientPinOf,
  formatLocalModelRef,
  isServableLocalModel,
  localRuntime,
  parseLocalModelRef,
  type LocalEndpoint,
  type LocalRuntimeId,
  type LocalRuntimeProbe,
} from '@builderforce/local-inference';
import {
  streamChatCompletion,
  type BrainTransport,
  type ChatCompletionMessage,
  type StreamChatOptions,
  type StreamChatResult,
  type StreamHandlers,
} from './streamChatCompletion';
import { contextWindowOf } from './windowFit/modelWindow';
import { withModelRef } from './localFirstErrors';
import { localTransport, type LocalFetch } from './localTransport';

/** A Brain streaming fn — structurally `BrainStreamFn`, restated to keep this module
 *  off the run store's import graph. */
export type StreamFn = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;

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
export interface LocalTarget {
  ref: string;
  provider: LocalRuntimeId;
  /** The bare id the runtime knows. */
  model: string;
  endpoint: LocalEndpoint;
}

/** The reachable runtime serving `ref`, from a probe. */
export function probedTarget(ref: string, probes: readonly LocalRuntimeProbe[]): LocalTarget | null {
  for (const p of probes) {
    if (!p.reachable) continue;
    const m = p.models.find((x) => x.ref === ref && isServableLocalModel(x));
    if (m) return { ref, provider: p.provider, model: m.model, endpoint: p.endpoint };
  }
  return null;
}

/** The messages a local attempt sends: fitted to the target's window when a fit is lent. */
export async function fittedFor(
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
export async function streamOnLocal(
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

/**
 * Forward a stream's handlers, marking the attempt COMMITTED on the first user-visible
 * output. For a local attempt the serving model is already known — the full local ref —
 * so it is reported up front (a runtime need not name its model in a header or chunk,
 * and the streamer's own `onModel` fires only when one does), and the streamer's later
 * report of the runtime's bare id is swallowed rather than overwriting the ref.
 */
export function committingHandlers(handlers: StreamHandlers, commit: () => void, servedAs?: string): StreamHandlers {
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
