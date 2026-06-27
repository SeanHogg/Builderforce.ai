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
