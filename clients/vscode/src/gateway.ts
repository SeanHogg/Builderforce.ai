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

/** Gateway base URL from settings, trailing slashes stripped. */
export function getBaseUrl(): string {
  const raw =
    vscode.workspace.getConfiguration("builderforce").get<string>("baseUrl") ||
    "https://api.builderforce.ai";
  return raw.replace(/\/+$/, "");
}

export function getApiKey(secrets: vscode.SecretStorage): Thenable<string | undefined> {
  return secrets.get(SECRET_KEY);
}

/**
 * The BuilderForce web app base URL (where workspace onboarding + embed pages live).
 * Derived from the gateway base (api.builderforce.ai → builderforce.ai), overridable
 * via `builderforce.webUrl`. Single source of truth for web deep-links.
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
 * Fetch the limbic affective-state directive block for a task/request from the
 * gateway (`/api/limbic/block`). The block makes the built-in agent execute
 * under the same affective layer as the cloud (V3) and on-prem agents. Logic
 * lives once in the shared compiler server-side — this is pure transport.
 * Best-effort: returns '' on any error so the agent always works offline.
 */
export async function fetchLimbicBlock(
  secrets: vscode.SecretStorage,
  text: string,
): Promise<string> {
  try {
    const key = await getApiKey(secrets);
    if (!key) return "";
    const res = await fetch(`${getBaseUrl()}/api/limbic/block`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return "";
    const json = (await res.json()) as { block?: string };
    return typeof json.block === "string" ? json.block : "";
  } catch {
    return "";
  }
}
