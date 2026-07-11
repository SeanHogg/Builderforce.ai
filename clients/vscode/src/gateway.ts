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
let modelsCache: { ts: number; data: string[] } | undefined;
const MODELS_TTL_MS = 5 * 60_000;

export async function getModels(
  secrets: vscode.SecretStorage,
  forceRefresh = false,
): Promise<string[]> {
  if (!forceRefresh && modelsCache && Date.now() - modelsCache.ts < MODELS_TTL_MS) {
    return modelsCache.data;
  }
  const key = await getApiKey(secrets);
  if (!key) throw new Error("not_signed_in");
  const res = await fetch(`${getBaseUrl()}/llm/v1/models`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`models_failed_${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const data = (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
  modelsCache = { ts: Date.now(), data };
  return data;
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
