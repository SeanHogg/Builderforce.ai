import * as path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  createSdkMcpServer,
  query,
  tool,
  type HookCallback,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { fromJSONSchema, looseObject, type ZodRawShape, type ZodObject } from "zod";
import type { ChatMessage } from "./gateway";
import type { ToolDef } from "./fileTools";
import { evaluatePolicyGate, type PolicyDecision, type PolicyGate } from "./policy";

const MCP_SERVER_NAME = "builderforce";
const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;
const MAX_TURNS = 40;
const READ_ONLY_NATIVE_TOOLS = new Set(["Read", "Glob", "Grep", "ToolSearch"]);
const MUTATING_NATIVE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "Bash"]);

export interface ClaudeSdkEvents {
  onText(delta: string): void;
  onToolStart(label: string): void;
  onToolResult(label: string, ok: boolean): void;
  onError(message: string, cause?: unknown): void;
}

export interface ClaudeSdkRunOptions {
  messages: ChatMessage[];
  tools: ToolDef[];
  cwd?: string;
  configDir: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  permissionMode: "ask" | "acceptEdits";
  policyGates?: PolicyGate[];
  approve(summary: string): Promise<boolean>;
  abortController: AbortController;
  events: ClaudeSdkEvents;
  onToolSucceeded?(name: string, args: Record<string, unknown>): void;
}

/** The packaged binary sits beside the bundled extension in out/claude-agent-sdk. */
export function packagedClaudeExecutable(baseDir = __dirname): string {
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  return path.join(baseDir, "claude-agent-sdk", name);
}

export function originalToolName(sdkName: string): string {
  return sdkName.startsWith(MCP_PREFIX) ? sdkName.slice(MCP_PREFIX.length) : sdkName;
}

function nativePolicyAlias(name: string): string {
  switch (name) {
    case "Read": return "read_file";
    case "Write": return "write_file";
    case "Edit":
    case "NotebookEdit": return "edit_file";
    case "Glob": return "list_files";
    case "Grep": return "search_code";
    case "Bash": return "run_command";
    default: return originalToolName(name);
  }
}

/** Match policy against both the SDK name and BuilderForce's canonical tool name. */
export function sdkPolicyDecision(gates: readonly PolicyGate[] | undefined, sdkName: string): PolicyDecision {
  const direct = evaluatePolicyGate(gates, originalToolName(sdkName));
  if (direct.action !== "allow") return direct;
  return evaluatePolicyGate(gates, nativePolicyAlias(sdkName));
}

function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function labelFor(name: string, args: Record<string, unknown>, defs: readonly ToolDef[]): string {
  const original = originalToolName(name);
  const def = defs.find((candidate) => candidate.name === original);
  if (def?.remote) {
    const verb = original.replace(/^builtin_/, "").replace(/_/g, " ");
    const subject =
      (typeof args.title === "string" && args.title) ||
      (typeof args.name === "string" && args.name) ||
      (typeof args.id !== "undefined" && `#${String(args.id)}`) ||
      "";
    return subject ? `${verb}: ${subject}` : verb;
  }
  const pathValue = typeof args.file_path === "string"
    ? args.file_path
    : typeof args.path === "string" ? args.path : "";
  if (pathValue) return `${nativePolicyAlias(name).replace(/_/g, " ")} ${pathValue}`;
  if (name === "Bash" && typeof args.command === "string") return `run: ${args.command.slice(0, 80)}`;
  return original.replace(/_/g, " ");
}

function toolShape(def: ToolDef): ZodRawShape {
  try {
    const converted = fromJSONSchema(def.parameters as never);
    const shape = (converted as ZodObject<ZodRawShape>).shape;
    if (shape && typeof shape === "object") return shape;
  } catch {
    // One third-party catalog schema must not take down the entire participant.
    // A loose object preserves its arguments; the remote tool remains authoritative
    // for validation and returns a normal tool error Claude can recover from.
  }
  return looseObject({}).shape;
}

function buildMcpServer(defs: readonly ToolDef[], opts: ClaudeSdkRunOptions) {
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: "1.0.0",
    instructions:
      "BuilderForce platform tools manage projects, tasks, OKRs, chats, memory, and cloud agents. " +
      "Use tool search to discover the specific platform tool needed instead of guessing a tool name.",
    alwaysLoad: false,
    tools: defs.map((def) => tool(
      def.name,
      def.description,
      toolShape(def),
      async (args) => {
        const parsed = argsRecord(args);
        const label = labelFor(def.name, parsed, defs);
        opts.events.onToolStart(label);
        try {
          const result = await def.execute(parsed, opts.cwd ?? "");
          opts.events.onToolResult(label, true);
          opts.onToolSucceeded?.(def.name, parsed);
          return { content: [{ type: "text" as const, text: result }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          opts.events.onToolResult(`${label} — ${message}`, false);
          return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
        }
      },
      { annotations: { readOnlyHint: !def.mutating } },
    )),
  });
}

function systemAndPrompt(messages: readonly ChatMessage[]): { system: string; prompt: string } {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : "")
    .filter(Boolean)
    .join("\n\n");
  const conversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const content = typeof message.content === "string" ? message.content : "";
      return content ? `${message.role === "user" ? "User" : "Assistant"}: ${content}` : "";
    })
    .filter(Boolean);
  const current = conversation.pop() ?? "User: Continue the task.";
  const prompt = conversation.length
    ? `Conversation so far:\n\n${conversation.join("\n\n")}\n\nCurrent turn:\n\n${current}`
    : current.replace(/^User:\s*/, "");
  return { system, prompt };
}

function textDelta(message: SDKMessage): string {
  if (message.type !== "stream_event") return "";
  const event = message.event as unknown as { type?: string; delta?: { type?: string; text?: unknown } };
  return event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string"
    ? event.delta.text
    : "";
}

function permissionResult(approved: boolean, message: string): PermissionResult {
  return approved ? { behavior: "allow" } : { behavior: "deny", message };
}

/** Run the VSIX's native participant on Claude Code's production agent loop. */
export async function runClaudeSdkAgent(opts: ClaudeSdkRunOptions): Promise<void> {
  await mkdir(opts.configDir, { recursive: true });
  const defs = opts.tools;
  const mcp = buildMcpServer(defs, opts);
  const { system, prompt } = systemAndPrompt(opts.messages);
  const readOnlyMcp = defs.filter((def) => !def.mutating).map((def) => `${MCP_PREFIX}${def.name}`);
  // Never let Claude Code fall back to the extension host's process directory.
  // With no folder open, the participant remains chat/platform-only.
  const nativeTools = opts.cwd
    ? ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "ToolSearch"]
    : ["ToolSearch"];
  const allowedNativeTools = opts.cwd ? [...READ_ONLY_NATIVE_TOOLS] : ["ToolSearch"];

  const preToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    const decision = sdkPolicyDecision(opts.policyGates, input.tool_name);
    if (decision.action === "block") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.reason,
        },
      };
    }
    if (decision.action === "require-approval") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: decision.reason,
        },
      };
    }
    if (!input.tool_name.startsWith(MCP_PREFIX)) {
      opts.events.onToolStart(labelFor(input.tool_name, argsRecord(input.tool_input), defs));
    }
    return { continue: true };
  };

  const postToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse" || input.tool_name.startsWith(MCP_PREFIX)) {
      return { continue: true };
    }
    const args = argsRecord(input.tool_input);
    opts.events.onToolResult(labelFor(input.tool_name, args, defs), true);
    opts.onToolSucceeded?.(nativePolicyAlias(input.tool_name), args);
    return { continue: true };
  };

  const postToolFailure: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUseFailure" || input.tool_name.startsWith(MCP_PREFIX)) {
      return { continue: true };
    }
    opts.events.onToolResult(`${labelFor(input.tool_name, argsRecord(input.tool_input), defs)} — ${input.error}`, false);
    return { continue: true };
  };

  let streamedText = "";
  try {
    const stream = query({
      prompt,
      options: {
        cwd: opts.cwd ?? opts.configDir,
        pathToClaudeCodeExecutable: packagedClaudeExecutable(),
        abortController: opts.abortController,
        model: opts.model,
        maxTurns: MAX_TURNS,
        includePartialMessages: true,
        persistSession: false,
        settingSources: [],
        strictMcpConfig: true,
        tools: nativeTools,
        allowedTools: [...allowedNativeTools, ...readOnlyMcp],
        permissionMode: opts.permissionMode === "acceptEdits" ? "acceptEdits" : "default",
        canUseTool: async (name, input, permission) => {
          const decision = sdkPolicyDecision(opts.policyGates, name);
          const label = labelFor(name, input, defs);
          if (decision.action === "block") return permissionResult(false, decision.reason);
          if (decision.action === "require-approval") {
            const approved = await opts.approve(`Governance: approve "${label}"? ${decision.reason}`);
            return permissionResult(approved, `Human declined governance approval for ${label}.`);
          }
          const def = defs.find((candidate) => candidate.name === originalToolName(name));
          const mutating = def?.mutating === true || MUTATING_NATIVE_TOOLS.has(name);
          if (!mutating || opts.permissionMode === "acceptEdits" && name !== "Bash") {
            return { behavior: "allow", toolUseID: permission.toolUseID };
          }
          const approved = await opts.approve(permission.title ?? label);
          return permissionResult(approved, `User declined ${label}.`);
        },
        hooks: {
          PreToolUse: [{ hooks: [preToolUse] }],
          PostToolUse: [{ hooks: [postToolUse] }],
          PostToolUseFailure: [{ hooks: [postToolFailure] }],
        },
        mcpServers: { [MCP_SERVER_NAME]: mcp },
        systemPrompt: { type: "preset", preset: "claude_code", append: system },
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: `${opts.baseUrl.replace(/\/+$/, "")}/llm`,
          ANTHROPIC_API_KEY: opts.apiKey,
          ANTHROPIC_CUSTOM_HEADERS: "x-builderforce-surface: vsix",
          CLAUDE_CONFIG_DIR: opts.configDir,
          CLAUDE_AGENT_SDK_CLIENT_APP: "builderforce-vsix",
          DISABLE_TELEMETRY: "1",
          DISABLE_ERROR_REPORTING: "1",
        },
      },
    });

    for await (const message of stream) {
      const delta = textDelta(message);
      if (delta) {
        streamedText += delta;
        opts.events.onText(delta);
      }
      if (message.type === "result") {
        if (message.subtype === "success") {
          if (!streamedText && message.result) opts.events.onText(message.result);
        } else {
          const error = message.errors.join("; ") || `Claude agent stopped: ${message.subtype}`;
          opts.events.onError(error);
        }
      }
    }
  } catch (error) {
    if (opts.abortController.signal.aborted || (error as { name?: string }).name === "AbortError") return;
    opts.events.onError(error instanceof Error ? error.message : String(error), error);
  }
}
