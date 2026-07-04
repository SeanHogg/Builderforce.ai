import * as vscode from "vscode";
import { ChatMessage, getApiKey, getBaseUrl } from "./gateway";
import { describeTool, TOOL_DEFS, type ToolDef } from "./fileTools";
import { listPlatformTools, describePlatformTool } from "./platformTools";
import { cognitionToolDefs, recallSystemMessage } from "./cognition";
import { evaluatePolicyGate, renderPolicyDirectives, type PolicyGate } from "./policy";

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
  /** Active project. Scopes the shared write-through memory (recall + remember_fact). */
  projectId?: number;
  model?: string;
  permissionMode: "ask" | "acceptEdits";
  /** Returns true if the user approves a mutating tool call. */
  approve: (summary: string) => Promise<boolean>;
  signal: AbortSignal;
  /** Compiled governance gates (compile-primitive policy modality). Enforced at the
   *  tool seam exactly as the cloud loop enforces them, so a gate authored on the
   *  agent's spec governs the IDE run identically. */
  policyGates?: PolicyGate[];
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

function toOpenAiTools(defs: ToolDef[]) {
  return defs.map((d) => ({
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
  // The SAME brain as the web: local workspace tools (file edits + Evermind's
  // write-through `remember_fact`, workspace-only) PLUS the shared, server-side
  // platform catalog (projects, tasks, OKRs, specs, …) fetched from the gateway
  // MCP relay. The platform tools are the one source of truth — not copied here —
  // so the IDE chat can do everything the web Brain can, even with no folder open.
  // File tools need a workspace; the shared-memory `remember_fact` needs only a
  // project (works chat-only). Gate each on what it actually requires.
  const localTools: ToolDef[] = [
    ...(deps.root ? TOOL_DEFS : []),
    ...(deps.projectId ? cognitionToolDefs(deps.secrets, deps.projectId) : []),
  ];
  const platformTools = await listPlatformTools(deps.secrets);
  const toolDefs: ToolDef[] = [...localTools, ...platformTools];
  const tools = toolDefs.length ? toOpenAiTools(toolDefs) : undefined;

  // Governance: render the gate directives into a leading system block so the model
  // is bound by the same policy on every surface; hard enforcement is at the tool
  // seam below. `policyAsked` tracks require-approval gates already approved this run.
  const governance = renderPolicyDirectives(deps.policyGates);
  if (governance) messages.unshift({ role: "system", content: governance });
  const policyAsked = new Set<string>();

  // Evermind recall: inject facts relevant to the latest user message as a
  // system block, before the first turn. Self-updating memory the agent reads
  // each request (write side is the `remember_fact` tool above). Best-effort.
  if (deps.projectId) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser?.content) {
      const recalled = await recallSystemMessage(deps.secrets, deps.projectId, String(lastUser.content));
      if (recalled) {
        const firstNonSystem = messages.findIndex((m) => m.role !== "system");
        messages.splice(firstNonSystem < 0 ? messages.length : firstNonSystem, 0, recalled);
      }
    }
  }

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
      const def = toolDefs.find((d) => d.name === tc.name);
      const toolCallId = tc.id || tc.name;
      if (!def) {
        messages.push({ role: "tool", tool_call_id: toolCallId, content: `Unknown tool: ${tc.name}` });
        continue;
      }
      // Local file tools need a workspace root; platform (remote) tools don't.
      if (!def.remote && !deps.root) {
        messages.push({ role: "tool", tool_call_id: toolCallId, content: `Tool "${tc.name}" needs an open workspace folder.` });
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = tc.args ? (JSON.parse(tc.args) as Record<string, unknown>) : {};
      } catch {
        messages.push({ role: "tool", tool_call_id: toolCallId, content: "Invalid tool arguments JSON." });
        continue;
      }

      const label = def.remote ? describePlatformTool(def.name, args) : describeTool(def.name, args);
      events.onToolStart(label);

      // Governance gate (compile-primitive policy modality), enforced BEFORE the tool
      // runs — the IDE mirror of the cloud loop's tool-seam check. `block` refuses;
      // `require-approval` asks the human (reusing the approve prompt) the first time.
      const gate = evaluatePolicyGate(deps.policyGates, def.name);
      if (gate.action === "block") {
        events.onToolResult(`${label} — blocked by policy`, false);
        messages.push({ role: "tool", tool_call_id: toolCallId, content: `Blocked by governance policy: ${gate.reason}. Do not retry — take another approach.` });
        continue;
      }
      if (gate.action === "require-approval" && !policyAsked.has(gate.gateId)) {
        const approved = await deps.approve(`Governance: approve "${def.name}"? ${gate.reason}`);
        policyAsked.add(gate.gateId);
        if (!approved) {
          events.onToolResult(`${label} (approval declined)`, false);
          messages.push({ role: "tool", tool_call_id: toolCallId, content: `Human declined approval for "${def.name}" (governance gate ${gate.gateId}).` });
          continue;
        }
      }

      if (def.mutating && deps.permissionMode === "ask") {
        const approved = await deps.approve(label);
        if (!approved) {
          events.onToolResult(`${label} (skipped)`, false);
          messages.push({ role: "tool", tool_call_id: toolCallId, content: "User declined this change." });
          continue;
        }
      }

      try {
        const result = await def.execute(args, deps.root ?? "");
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
