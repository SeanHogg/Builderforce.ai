/**
 * On-device model support for the editor surface — a chat turn served by a runtime on
 * the DEVELOPER'S OWN MACHINE (Ollama, FreeToken) instead of the BuilderForce gateway.
 *
 * This is the DIRECT path, and it is deliberately distinct from the cloud's
 * `direct/ollama-local/default` vendor (`api/.../vendors/ollamaLocal.ts`). That one
 * exists so a CLOUD turn can reach a tenant's private runtime, which the Worker cannot
 * address itself — so it relays through the connected agent host's egress fence. The
 * extension host has no such problem: it is a Node process already running on the same
 * machine as the runtime, so it opens the socket itself. The two are complementary, not
 * duplicates: the relay serves cloud/on-prem tenants, this serves the editor offline,
 * with no account, no plan and no gateway round trip.
 *
 * Both supported runtimes speak the OpenAI wire format (`POST /v1/chat/completions`,
 * `{ model, messages, tools }`, SSE deltas), which is what lets the SHARED
 * `streamChatCompletion` drive them unchanged — the agent loop, tool-call protocol and
 * error mapping are the exact ones a gateway turn uses. The only difference is WHERE the
 * bytes go, which is why the whole adaptation is a URL rewrite plus a null token
 * ({@link localTransport}) rather than a second client.
 *
 * Kept free of any `vscode` import so the ref grammar and URL derivation are unit
 * testable in the harness (there is no extension-host stub in the vitest run). The
 * settings READ lives with the other configuration accessors in `gateway.ts`; this
 * module is handed the resolved values.
 */

import {
  streamChatCompletion,
  type BrainStreamFn,
  type BrainTransport,
} from "@seanhogg/builderforce-brain-embedded";

/**
 * The message shape this module puts on the wire — STRUCTURAL on purpose.
 *
 * The two message types in play are not assignable to one another (the gateway client's
 * `ChatMessage.content` is `string | null`; the shared streamer's
 * `ChatCompletionMessage.content` is `string | ContentPart[]`), and this module only ever
 * JSON-serializes the value. Naming the fields it depends on — rather than importing
 * either type — keeps both callers working without a cast and without coupling the local
 * path to whichever type happens to widen next.
 */
export interface LocalChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}

/**
 * Ref prefix marking a model the EXTENSION HOST serves directly. Mirrors the gateway's
 * `direct/<vendor>/<model>` grammar so a pinned ref stays self-describing wherever it is
 * stored (settings, session state), and so a ref can never be confused for a gateway
 * catalog id — which matters because a local ref must NOT be entitlement-checked against
 * the tenant's plan (it spends nothing).
 */
export const LOCAL_MODEL_PREFIX = "local/";

/** The on-device runtimes the editor can drive. */
export type LocalProviderId = "ollama" | "freetoken";

export const LOCAL_PROVIDER_IDS: readonly LocalProviderId[] = ["ollama", "freetoken"];

/** Resolved `builderforce.localModels.*` settings, read by `gateway.ts`. */
export interface LocalModelsConfig {
  enabled: boolean;
  /** Base origin of each runtime, as configured (unnormalized). */
  baseUrls: Readonly<Record<LocalProviderId, string>>;
}

/** One model a local runtime reported from its `/v1/models` catalog. */
export interface LocalModel {
  /** The full `local/<provider>/<model>` ref to pin. */
  ref: string;
  provider: LocalProviderId;
  /** The bare id the runtime itself knows, e.g. `qwen3:8b` / `gpt-oss-20b`. */
  model: string;
}

/**
 * Normalize a configured base origin to the runtime's ROOT, tolerating the two forms a
 * user is likely to paste: the bare origin (`http://127.0.0.1:1919`) and the
 * OpenAI-compatible base that most provider docs show (`http://127.0.0.1:1919/v1`).
 * Both must land on the same root, because every path this module builds appends `/v1`
 * itself. Trailing slashes are stripped so the result concatenates cleanly.
 *
 * Deliberately mirrors `normalizeOllamaBaseUrl` in the cloud vendor module: a tenant who
 * saved the `.../v1` form there gets the same forgiveness here.
 */
export function normalizeLocalBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/** The OpenAI-compatible chat endpoint for a normalized runtime root. */
export function localChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeLocalBaseUrl(baseUrl)}/v1/chat/completions`;
}

/** The OpenAI-compatible catalog endpoint for a normalized runtime root. */
export function localModelsUrl(baseUrl: string): string {
  return `${normalizeLocalBaseUrl(baseUrl)}/v1/models`;
}

/**
 * Whether `url` is one of the chat endpoints this machine is configured to serve.
 *
 * The destination fence for the webview's host-performed fetch (`llm.fetch` in
 * `brainWebview.ts`). The webview is our own bundle, but a proxy that forwards whatever
 * URL it is handed is a request forwarder into the user's machine — and it would outlive
 * whatever we currently believe that bundle can be made to send. So the host, not the
 * caller, decides where a proxied request may land: the same rule the agent host's egress
 * relay applies to the cloud.
 *
 * Lives here, beside the endpoint composition it compares against, so the fence cannot
 * drift from the URLs the rest of the module builds — and so it is testable without an
 * extension host.
 */
export function isLocalChatEndpoint(config: LocalModelsConfig, url: string): boolean {
  return LOCAL_PROVIDER_IDS.some((provider) => {
    const base = config.baseUrls[provider];
    return base.trim().length > 0 && localChatCompletionsUrl(base) === url;
  });
}

/** Compose the pinned ref for a model on a local runtime. */
export function formatLocalModelRef(provider: LocalProviderId, model: string): string {
  return `${LOCAL_MODEL_PREFIX}${provider}/${model}`;
}

/**
 * Split `local/<provider>/<model>` back apart, or null when `ref` is not a local pin
 * (a gateway catalog id, an Evermind pin, or undefined).
 *
 * Splits on the first two separators ONLY: an Ollama id legitimately contains both `:`
 * and `/` (`qwen3:8b`, `hf.co/user/repo:q4`), so the model segment is whatever remains
 * after the provider — never re-split.
 */
export function parseLocalModelRef(
  ref: string | undefined,
): { provider: LocalProviderId; model: string } | null {
  if (!ref || !ref.startsWith(LOCAL_MODEL_PREFIX)) return null;
  const rest = ref.slice(LOCAL_MODEL_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const provider = rest.slice(0, slash);
  const model = rest.slice(slash + 1);
  if (!model || !LOCAL_PROVIDER_IDS.includes(provider as LocalProviderId)) return null;
  return { provider: provider as LocalProviderId, model };
}

/** Whether a ref names an on-device model (so it must bypass gateway entitlement). */
export function isLocalModelRef(ref: string | undefined): boolean {
  return parseLocalModelRef(ref) !== null;
}

/**
 * The gateway path `streamChatCompletion` builds, and the local path it must become.
 *
 * The shared streamer hard-codes `POST {baseUrl}/llm/v1/chat/completions` — correct for
 * the gateway, wrong for a runtime that serves the plain OpenAI route at `/v1/...`.
 * Rather than fork the streamer (a second client to keep in step forever), the transport
 * rewrites the one path it will ever be handed. Exported so the harness asserts the
 * rewrite against the constant the streamer actually uses.
 */
export const GATEWAY_COMPLETIONS_PATH = "/llm/v1/chat/completions";
export const LOCAL_COMPLETIONS_PATH = "/v1/chat/completions";

/** Rewrite the gateway completions URL onto the runtime's OpenAI route. Any other URL
 *  passes through untouched, so a future streamer call to a different path fails loudly
 *  at the runtime rather than being silently mangled here. */
export function rewriteToLocalUrl(url: string): string {
  return url.endsWith(GATEWAY_COMPLETIONS_PATH)
    ? `${url.slice(0, -GATEWAY_COMPLETIONS_PATH.length)}${LOCAL_COMPLETIONS_PATH}`
    : url;
}

/**
 * The transport that points the SHARED streamer at a local runtime.
 *
 * `getToken` returns null on purpose: a local runtime has no account, and the streamer
 * omits the `Authorization` header entirely when the token is null — so an unauthenticated
 * editor (signed out, or never signed in) can still run a local turn. That is the whole
 * point of the direct path.
 */
export function localTransport(
  baseUrl: string,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
): BrainTransport {
  return {
    baseUrl: normalizeLocalBaseUrl(baseUrl),
    getToken: () => null,
    fetch: (input, init) => fetchImpl(rewriteToLocalUrl(input), init),
  };
}

/**
 * The streaming completion fn for a pinned local model — the local twin of
 * `createNativeStream`, and the reason the participant needs no branch beyond choosing
 * which of the two to hand the loop.
 *
 * The loop pins the FULL `local/<provider>/<model>` ref, but the runtime only knows its
 * own bare id, so `model` is overridden here with the parsed segment. Everything else in
 * `opts` (tools, messages, signal) rides through unchanged — both runtimes ignore the
 * gateway-only fields (`strict`, `routingMode`, `metadata`) rather than rejecting them.
 */
export function createLocalStream(
  baseUrl: string,
  model: string,
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>,
): BrainStreamFn {
  const transport = localTransport(baseUrl, fetchImpl);
  return (opts, handlers) => streamChatCompletion({ ...opts, model, transport }, handlers);
}

/**
 * A non-streaming completion against a local runtime — the local twin of `complete()`,
 * used by the codebase scanner. Returns the assistant text (empty string when the model
 * produced none), and throws on a non-OK response so the caller's existing failure path
 * is unchanged.
 */
export async function completeLocal(
  baseUrl: string,
  model: string,
  messages: readonly LocalChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(localChatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`local_complete_failed_${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Ask ONE runtime for its catalog. A runtime that is not running is the NORMAL case —
 * a developer with only Ollama installed still opens the picker — so an unreachable or
 * malformed endpoint yields an empty list rather than throwing. The picker simply shows
 * no rows for that provider.
 *
 * A short timeout keeps a wedged or wrong-port endpoint from stalling the picker: this
 * runs on localhost, where a healthy answer is immediate.
 */
export async function listProviderModels(
  provider: LocalProviderId,
  baseUrl: string,
  timeoutMs = 2_000,
): Promise<LocalModel[]> {
  if (!baseUrl.trim()) return [];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(localModelsUrl(baseUrl), {
      headers: { accept: "application/json" },
      signal: abort.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return (json.data ?? [])
      .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
      .filter((id) => id.length > 0)
      .map((model) => ({ ref: formatLocalModelRef(provider, model), provider, model }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every model reachable on this machine, across both runtimes. Providers are probed
 * concurrently (two localhost round trips must not be serialized behind one another)
 * and a dead provider contributes nothing.
 */
export async function listLocalModels(config: LocalModelsConfig): Promise<LocalModel[]> {
  if (!config.enabled) return [];
  const lists = await Promise.all(
    LOCAL_PROVIDER_IDS.map((provider) => listProviderModels(provider, config.baseUrls[provider])),
  );
  return lists.flat();
}
