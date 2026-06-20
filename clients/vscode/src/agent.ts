import * as vscode from "vscode";
import { ChatMessage, getApiKey, getBaseUrl } from "./gateway";
import { describeTool, TOOL_DEFS } from "./fileTools";

export interface AgentEvents {
  onText: (delta: string) => void;
  onToolStart: (label: string) => void;
  onToolResult: (label: string, ok: boolean) => void;
  onError: (message: string) => void;
}

export interface AgentDeps {
  secrets: vscode.SecretStorage;
  /** Workspace root. When undefined, file tools are disabled (chat-only). */
  root?: string;
  model?: string;
  permissionMode: "ask" | "acceptEdits";
  /** Returns true if the user approves a mutating tool call. */
  approve: (summary: string) => Promise<boolean>;
  signal: AbortSignal;
}

const MAX_ITERATIONS = 12;

interface RawToolCall {
  id: string;
  name: string;
  args: string;
}

/** Turn a raw gateway error body into a clean, human-readable message. */
function prettyGatewayError(status: number, body: string): string {
  let msg = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: string | { message?: string } };
    if (typeof parsed.error === "string") msg = parsed.error;
    else if (parsed.error?.message) msg = parsed.error.message;
  } catch {
    /* not JSON — keep raw */
  }
  if (status === 401 || status === 403) return `${msg} (try signing in again)`;
  if (status === 429) return msg; // gateway already explains quota/limit
  return `${msg} (HTTP ${status})`;
}

function toOpenAiTools() {
  return TOOL_DEFS.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}

/**
 * Run the agentic loop in place on `messages` (it appends assistant + tool turns).
 * Streams assistant text via events; executes tool calls against the sandboxed
 * file tools, gated by the permission mode.
 */
export async function runAgent(
  messages: ChatMessage[],
  deps: AgentDeps,
  events: AgentEvents,
): Promise<void> {
  const tools = deps.root ? toOpenAiTools() : undefined;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (deps.signal.aborted) return;

    let turn: { content: string; toolCalls: RawToolCall[] };
    try {
      turn = await streamTurn(messages, tools, deps, events);
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === "AbortError") return;
      events.onError(err.message ?? String(e));
      return;
    }

    if (turn.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: turn.content });
      return;
    }

    // Assistant turn that requested tools.
    messages.push({
      role: "assistant",
      content: turn.content || null,
      tool_calls: turn.toolCalls.map((tc) => ({
        id: tc.id || tc.name,
        type: "function",
        function: { name: tc.name, arguments: tc.args || "{}" },
      })),
    });

    for (const tc of turn.toolCalls) {
      const def = TOOL_DEFS.find((d) => d.name === tc.name);
      const toolCallId = tc.id || tc.name;
      if (!def || !deps.root) {
        messages.push({ role: "tool", tool_call_id: toolCallId, content: `Unknown tool: ${tc.name}` });
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = tc.args ? (JSON.parse(tc.args) as Record<string, unknown>) : {};
      } catch {
        messages.push({ role: "tool", tool_call_id: toolCallId, content: "Invalid tool arguments JSON." });
        continue;
      }

      const label = describeTool(def.name, args);
      events.onToolStart(label);

      if (def.mutating && deps.permissionMode === "ask") {
        const approved = await deps.approve(label);
        if (!approved) {
          events.onToolResult(`${label} (skipped)`, false);
          messages.push({ role: "tool", tool_call_id: toolCallId, content: "User declined this change." });
          continue;
        }
      }

      try {
        const result = await def.execute(args, deps.root);
        events.onToolResult(label, true);
        messages.push({ role: "tool", tool_call_id: toolCallId, content: result });
      } catch (e) {
        const msg = (e as { message?: string }).message ?? String(e);
        events.onToolResult(`${label} — ${msg}`, false);
        messages.push({ role: "tool", tool_call_id: toolCallId, content: `Error: ${msg}` });
      }
    }
  }

  events.onError(`Stopped after ${MAX_ITERATIONS} tool iterations.`);
}

/** One streamed turn: accumulates assistant text and any tool-call deltas. */
async function streamTurn(
  messages: ChatMessage[],
  tools: ReturnType<typeof toOpenAiTools> | undefined,
  deps: AgentDeps,
  events: AgentEvents,
): Promise<{ content: string; toolCalls: RawToolCall[] }> {
  const key = await getApiKey(deps.secrets);
  if (!key) throw new Error("not_signed_in");

  const body: Record<string, unknown> = { messages, stream: true };
  if (deps.model) body.model = deps.model;
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${getBaseUrl()}/llm/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: deps.signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(prettyGatewayError(res.status, txt));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const calls: RawToolCall[] = [];

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
      if (payload === "[DONE]") return { content, toolCalls: calls.filter(Boolean) };
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          events.onText(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const slot = (calls[idx] ??= { id: "", name: "", args: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
        }
      } catch {
        /* keepalive / partial frame */
      }
    }
  }

  return { content, toolCalls: calls.filter(Boolean) };
}
