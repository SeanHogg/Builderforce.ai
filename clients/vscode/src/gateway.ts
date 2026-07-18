import * as vscode from "vscode";

/** Single source of truth for the SecretStorage key (DRY). */
export const SECRET_KEY = "builderforce.apiKey";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** null is valid for an assistant turn that only emits tool calls. */
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Gateway base URL from settings, trailing slashes stripped. Defaults to the
 * primary domain's same-origin gateway path (`builderforce.ai/gateway`) so it
 * reaches the API on corporate networks that whitelist the main site but block
 * the `api.` subdomain. The fallback here matches the manifest default and is
 * only hit if a user explicitly blanks the setting.
 */
export function getBaseUrl(): string {
  const raw =
    vscode.workspace.getConfiguration("builderforce").get<string>("baseUrl") ||
    "https://builderforce.ai/gateway";
  return raw.replace(/\/+$/, "");
}

export function getApiKey(secrets: vscode.SecretStorage): Thenable<string | undefined> {
  return secrets.get(SECRET_KEY);
}

/** How the Sessions view opens chats (see `builderforce.sessionTabs`). */
export type SessionTabMode = "reuse" | "perSession";

/**
 * Whether opening a session reuses the single chat tab (switching conversations
 * inside it — the default, and how the panel has always behaved) or gives each
 * session its own tab so the user can switch between them like editor tabs.
 * Single source of truth: everything that branches on tab behaviour reads this.
 */
export function getSessionTabMode(): SessionTabMode {
  return vscode.workspace.getConfiguration("builderforce").get<string>("sessionTabs") === "perSession"
    ? "perSession"
    : "reuse";
}

/**
 * The BuilderForce web app base URL (where workspace onboarding + embed pages live).
 * Derived from the gateway base by dropping any `api.` host prefix AND the path
 * (so both `https://api.builderforce.ai` and `https://builderforce.ai/gateway`
 * resolve to `https://builderforce.ai`). Overridable via `builderforce.webUrl`.
 * Single source of truth for web deep-links.
 */
export function getWebBaseUrl(): string {
  const override = vscode.workspace.getConfiguration("builderforce").get<string>("webUrl");
  if (override) return override.replace(/\/+$/, "");
  try {
    const u = new URL(getBaseUrl());
    u.hostname = u.hostname.replace(/^api\./, "");
    u.pathname = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return "https://builderforce.ai";
  }
}

/**
 * Models cache. Intentional single-process, in-memory TTL cache: the cross-isolate
 * `getOrSetCached` rule governs the Cloudflare backend; a VS Code extension host is a
 * single Node process serving one user, so a local TTL cache is the correct shape here.
 * `forceRefresh` busts it; the model pool is slow-changing.
 */
let modelsCache: { ts: number; data: ModelChoices } | undefined;
const MODELS_TTL_MS = 5 * 60_000;

/** One model served through a tenant's OWN connected provider account (BYO). Mirrors
 *  `byoModelsFor()` in the API's llmRoutes — `vendor` is the provider key the settings
 *  page uses (anthropic / openai / google / meta / xai …). */
export interface ByoModel {
  id: string;
  vendor: string;
  tier: string;
  contextWindow?: number;
}

/** The tenant's connected-provider (BYO) surface from `GET /llm/v1/models`. */
export interface ByoChoices {
  /** Connected provider keys, e.g. ['anthropic', 'openai']. */
  providers: string[];
  /** The models those accounts can serve — billed to the TENANT's own key, $0 to us. */
  models: ByoModel[];
}

/**
 * The model lists the picker offers. THREE distinct funding tiers, which is why they
 * are kept apart rather than flattened into one list:
 *
 *   - `models`        — the tenant's PLAN POOL. Included in the plan, no extra charge.
 *   - `byo.models`    — served by the tenant's OWN connected provider account. Billed
 *                       to their key; costs the platform nothing. Connecting a provider
 *                       is ALSO what unlocks model choice on the free plan.
 *   - `premiumModels` — any paid OpenRouter model, at OpenRouter cost + a flat
 *                       1¢/request. Needs a paid plan AND a validated card, which is a
 *                       STRICTER rule than frontier access (hence the separate flag).
 *
 * `canChooseModel` (server alias for `canUseFrontierModels`) gates the picker as a
 * whole: false ⇒ the gateway will reject a pinned model, so we must not offer one.
 * `teacherModels` are the frontier models eligible to distil into an Evermind.
 *
 * Every one of these was previously parsed away and dropped on the floor — the
 * response has carried them all along.
 */
export interface ModelChoices {
  models: string[];
  canUsePremiumModels: boolean;
  premiumModels: string[];
  /** False ⇒ the tenant may not pin a model at all; offer only "auto". */
  canChooseModel: boolean;
  canUseFrontierModels: boolean;
  byo: ByoChoices;
  /** Frontier models this tenant may teach an Evermind with. */
  teacherModels: string[];
}

/** The subset of `GET /llm/v1/models` this client consumes. */
interface ModelsResponse {
  data?: Array<{ id?: string }>;
  canUsePremiumModels?: boolean;
  canChooseModel?: boolean;
  canUseFrontierModels?: boolean;
  teacherModels?: string[];
  byo?: { providers?: string[]; models?: ByoModel[] };
}

/** One paid OpenRouter model from `GET /llm/v1/catalog`. `pool` is set when the free/
 *  pro plan already routes the id — those are NOT premium (no surcharge). */
interface CatalogModel {
  id?: string;
  pricing?: { prompt?: number; completion?: number };
  pool?: "free" | "pro";
  /** Gateway-advertised tunable params. Must include "tools" to drive the Brain's
   *  tool loop. */
  supportedParameters?: string[];
}

export async function getModels(
  secrets: vscode.SecretStorage,
  forceRefresh = false,
): Promise<ModelChoices> {
  if (!forceRefresh && modelsCache && Date.now() - modelsCache.ts < MODELS_TTL_MS) {
    return modelsCache.data;
  }
  const key = await getApiKey(secrets);
  if (!key) throw new Error("not_signed_in");
  const res = await fetch(`${getBaseUrl()}/llm/v1/models`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`models_failed_${res.status}`);
  const json = (await res.json()) as ModelsResponse;
  const models = (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id);

  // Premium is the whole paid OpenRouter catalog, so it is NOT inlined into
  // /v1/models — it comes from the cached public /v1/catalog. Only fetch it for an
  // entitled tenant; a failure degrades to "no premium" rather than breaking the picker.
  const canUsePremiumModels = json.canUsePremiumModels === true;
  const premiumModels = canUsePremiumModels ? await getPremiumCatalog().catch(() => []) : [];

  // BYO + entitlement flags. Tolerant of an older gateway that omits them: no BYO,
  // and model choice defaults to whatever premium access says (the pre-existing
  // behaviour), so the picker degrades instead of locking the user out.
  const byo: ByoChoices = {
    providers: (json.byo?.providers ?? []).filter((p): p is string => typeof p === 'string'),
    models: (json.byo?.models ?? []).filter((m): m is ByoModel => !!m && typeof m.id === 'string'),
  };
  const canUseFrontierModels = json.canUseFrontierModels === true;
  const canChooseModel = json.canChooseModel ?? (canUseFrontierModels || canUsePremiumModels || byo.providers.length > 0);

  const data: ModelChoices = {
    models,
    canUsePremiumModels,
    premiumModels,
    canChooseModel,
    canUseFrontierModels,
    byo,
    teacherModels: json.teacherModels ?? [],
  };
  modelsCache = { ts: Date.now(), data };
  return data;
}

/**
 * Paid OpenRouter models the plan pool does NOT already route — the premium tier.
 * Mirrors the server's `isPremiumModelSelection`: a model that costs money and carries
 * no `pool` marker. Cheapest-first so the picker's top entries are the affordable ones.
 *
 * TOOL-CAPABLE ONLY: the selected model drives the Brain's tool loop on every editor
 * chat turn, so a premium model that can't call tools would break the surface it was
 * picked for. Same filter the web picker's coding variant applies.
 */
async function getPremiumCatalog(): Promise<string[]> {
  const res = await fetch(`${getBaseUrl()}/llm/v1/catalog`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`catalog_failed_${res.status}`);
  const json = (await res.json()) as { data?: CatalogModel[] };
  return (json.data ?? [])
    .filter((m) =>
      !!m.id && !m.pool &&
      ((m.pricing?.prompt ?? 0) > 0 || (m.pricing?.completion ?? 0) > 0) &&
      (m.supportedParameters?.includes("tools") ?? false))
    .sort((a, b) =>
      ((a.pricing?.prompt ?? 0) + (a.pricing?.completion ?? 0)) -
      ((b.pricing?.prompt ?? 0) + (b.pricing?.completion ?? 0)))
    .map((m) => m.id as string);
}

/**
 * Builder-level Insights snapshot — the real-time builder spend/budget surface
 * pushed from the gateway. Mirrors `BuilderInsightsSnapshot` in
 * `api/src/application/insights/builderInsights.ts`.
 */
export interface BuilderInsightsSnapshot {
  generatedAt: string;
  windowLabel: string;
  todayTokens: number;
  todayCostUsd: number;
  dailyCapTokens: number | null;
  pctOfDailyCap: number | null;
  topModel: { model: string; tokens: number } | null;
  costPerMergedPrUsd: number | null;
  tip: string | null;
}

/** The `?projectId=` suffix for the insights endpoints when a project is in scope. */
function insightsProjectQuery(projectId?: number | null): string {
  return projectId != null ? `?projectId=${projectId}` : "";
}

/** Fetch the current builder-insights snapshot once (cached server-side). Scoped to
 *  `projectId` when set, else the whole tenant/caller. */
export async function getBuilderInsights(
  secrets: vscode.SecretStorage,
  projectId?: number | null,
): Promise<BuilderInsightsSnapshot> {
  const key = await getApiKey(secrets);
  if (!key) throw new Error("not_signed_in");
  const res = await fetch(`${getBaseUrl()}/llm/v1/builder-insights${insightsProjectQuery(projectId)}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`insights_failed_${res.status}`);
  return (await res.json()) as BuilderInsightsSnapshot;
}

/**
 * Subscribe to the builder-insights SSE stream. Invokes `onSnapshot` for each
 * `data:` frame until the stream closes or `signal` aborts. Throws
 * `not_signed_in` when no key, and `insights_stream_failed_<status>` on a bad
 * response so the caller can decide whether to reconnect. Mirrors the SSE
 * frame parser in agent-runtime's native-llm.ts.
 */
export async function streamBuilderInsights(
  secrets: vscode.SecretStorage,
  onSnapshot: (s: BuilderInsightsSnapshot) => void,
  signal: AbortSignal,
  projectId?: number | null,
): Promise<void> {
  const key = await getApiKey(secrets);
  if (!key) throw new Error("not_signed_in");
  const res = await fetch(`${getBaseUrl()}/llm/v1/builder-insights/stream${insightsProjectQuery(projectId)}`, {
    headers: { authorization: `Bearer ${key}`, accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`insights_stream_failed_${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleFrame = (frame: string): void => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (eventName === "error" || dataLines.length === 0) return;
    try {
      const snapshot = JSON.parse(dataLines.join("\n")) as BuilderInsightsSnapshot;
      onSnapshot(snapshot);
    } catch {
      /* ignore malformed frame */
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE frames are separated by a blank line.
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (frame.trim()) handleFrame(frame);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}

/** Non-streaming completion (used by the codebase scanner). */
export async function complete(
  secrets: vscode.SecretStorage,
  messages: ChatMessage[],
  model: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const key = await getApiKey(secrets);
  if (!key) throw new Error("not_signed_in");
  const body: Record<string, unknown> = { messages, stream: false };
  if (model) body.model = model;
  const res = await fetch(`${getBaseUrl()}/llm/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`complete_failed_${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Personality/persona context sent to `POST /api/limbic/block` so the returned
 * directive block carries PERSONALITY (setpoints + psychometric directives), not
 * just the affective appraisal of the text. Every field is optional and
 * backward-compatible — an empty body still yields the neutral limbic block.
 *
 *   - `userId`      : the signed-in HUMAN whose personality shapes chat TONE. The
 *                     gateway resolves their stored psychometric profile.
 *   - `psychometric`: an explicit profile, when the caller already holds it.
 *   - `agentId`     : the active agent persona, when the chat runs AS an agent.
 *   - `personaId`   : a saved platform persona id, when one is active.
 */
export interface PersonaContext {
  userId?: string;
  psychometric?: unknown;
  agentId?: string | number;
  personaId?: string | number;
}

/**
 * The ONE transport to the affective/personality block endpoint
 * (`/api/limbic/block`). Both the per-turn limbic fetch and the cached
 * personality-only fetch route through here so the request/auth logic lives in a
 * single place (DRY). Best-effort: '' on any error so the agent works offline.
 */
async function postAffectiveBlock(
  secrets: vscode.SecretStorage,
  body: Record<string, unknown>,
): Promise<string> {
  try {
    const key = await getApiKey(secrets);
    if (!key) return "";
    const res = await fetch(`${getBaseUrl()}/api/limbic/block`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return "";
    // The endpoint returns TWO directive layers: `block` (dynamic affect from the
    // task appraisal) and `personaBlock` (STATIC personality tone). Both are
    // system-prompt directives — join the non-empty ones so callers get affect
    // AND personality (the personality-only fetch sends empty text, so `block` is
    // near-empty and `personaBlock` carries the signal).
    const json = (await res.json()) as { block?: string; personaBlock?: string };
    return [json.block, json.personaBlock]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Fetch the affective-state + PERSONALITY directive block for a task/request from
 * the gateway (`/api/limbic/block`). The block makes the built-in agent execute
 * under the same affective layer AND personality tone as the cloud (V3) and
 * on-prem agents. Pass a {@link PersonaContext} (e.g. the signed-in user's
 * `userId`) so the returned block carries personality; omit it for a
 * text-only (neutral-personality) appraisal. Logic lives once in the shared
 * compiler server-side — this is pure transport.
 */
export async function fetchLimbicBlock(
  secrets: vscode.SecretStorage,
  text: string,
  persona?: PersonaContext,
): Promise<string> {
  return postAffectiveBlock(secrets, { text, ...(persona ?? {}) });
}

// Session cache for the STATIC personality-only block (text is empty, so no
// per-message limbic appraisal — only the personality directives vary, and only
// when the persona context changes). Keyed on the persona context so a user /
// persona switch re-fetches, but repeated turns in a session reuse it. This is
// the perf seam that keeps the webview from re-fetching personality per message.
let personalityCache: { key: string; block: string } | undefined;

/**
 * Fetch the signed-in user's (or an agent persona's) PERSONALITY-only directive
 * block, cached for the session. Used where personality is static across the
 * conversation (the Brain webview), so it is injected once via ambient system
 * context rather than re-fetched per turn. Returns '' when the profile is neutral
 * or unavailable (a no-op).
 */
export async function fetchPersonalityBlock(
  secrets: vscode.SecretStorage,
  persona?: PersonaContext,
): Promise<string> {
  const key = JSON.stringify(persona ?? {});
  if (personalityCache && personalityCache.key === key) return personalityCache.block;
  const block = await postAffectiveBlock(secrets, { text: "", ...(persona ?? {}) });
  personalityCache = { key, block };
  return block;
}

/** Drop the cached personality block (e.g. on sign-out or a personality change). */
export function clearPersonalityBlockCache(): void {
  personalityCache = undefined;
}
