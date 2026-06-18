import * as vscode from "vscode";

/** Single source of truth for the SecretStorage key (DRY). */
export const SECRET_KEY = "builderforce.apiKey";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
 * Models cache. Intentional single-process, in-memory TTL cache: the cross-isolate
 * `getOrSetCached` rule governs the Cloudflare backend; a VS Code extension host is a
 * single Node process serving one user, so a local TTL cache is the correct shape here.
 * The model pool is slow-changing; `forceRefresh` (the "Pick Model" command after sign-in
 * changes) busts it.
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
 * Stream an OpenAI-compatible chat completion from the gateway. The bearer key never
 * leaves the extension host — the webview proxies through here (D4 in PRD 14).
 */
export async function* streamChat(
  secrets: vscode.SecretStorage,
  messages: ChatMessage[],
  model: string | undefined,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const key = await getApiKey(secrets);
  if (!key) throw new Error("not_signed_in");

  const body: Record<string, unknown> = { messages, stream: true };
  if (model) body.model = model;

  const res = await fetch(`${getBaseUrl()}/llm/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`chat_failed_${res.status}: ${txt.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* keepalive / partial frame — ignore */
      }
    }
  }
}
