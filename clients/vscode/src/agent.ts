import * as vscode from "vscode";
import {
  streamChatCompletion,
  chatWorkLinkingDirective,
  isCodeChangeTool,
  isTicketRecordingTool,
  codeChangeFile,
  linkedTicketsToAdvance,
  type BrainTransport,
  type ChatCompletionMessage,
  type BrainToolSpec,
} from "@seanhogg/builderforce-brain-embedded";
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
  /**
   * The session's Brain chat id. Binds the run's work to a conversation exactly as
   * the webview Brain does: the chat-work-linking directive is injected with this id
   * (so the model links created work + code-change deltas to THIS chat), and the
   * post-run "a code change is always tied to a ticket" backstop passes it to
   * from_delta. Omit for a chat-less run (the backstop still mints an unlinked ticket).
   */
  chatId?: number;
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

// The in-editor loop's tool-step budget. Kept modest on purpose — a genuinely large
// job should be HANDED to the platform (persona's dispatch-handoff strategy: create a
// task + assign a cloud agent), not ground through inline. 12 was too low for even
// ordinary multi-file work; 40 covers real inline tasks while still capping runaway
// loops, and the ceiling message points at dispatch rather than dead-ending.
const MAX_ITERATIONS = 40;

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

  // Bind this run's work to the conversation, mirroring the shared webview/web Brain
  // loop (brainRunStore): tell the model its chatId so identified work is CREATED +
  // linked to the chat and code changes are recorded via from_delta tied to it. The
  // deterministic backstop below guarantees the code-change half regardless.
  if (deps.chatId != null) {
    messages.unshift({ role: "system", content: chatWorkLinkingDirective(deps.chatId) });
  }
  // Backstop bookkeeping: whether a workspace file-change tool succeeded, whether the
  // model itself recorded a ticket (from_delta / link / review), and which files it
  // touched — so a code-changing turn that never linked its work gets a ticket minted.
  let codeChanged = false;
  let ticketRecorded = false;
  const touchedFiles: string[] = [];

  // Guarantee a code change is tied to a ticket: if the run CHANGED code but never
  // recorded/linked one itself, mint a ticket now via the platform from_delta tool
  // (tied to the chat when we have one), so an edit is never invisible or unlinked —
  // the native-participant twin of the webview loop's backstop. Best-effort: never
  // throws, never blocks the reply, skipped on cancel or with no project scope.
  const flushCodeChangeTicket = async (): Promise<void> => {
    if (!codeChanged || ticketRecorded || deps.projectId == null || deps.signal.aborted) return;
    const fromDelta = toolDefs.find((d) => d.name === "builtin_tickets_from_delta");
    if (!fromDelta) return;
    const files = touchedFiles.slice(0, 50);
    const summary = files.length
      ? `Code change (${files.length} file${files.length === 1 ? "" : "s"}) from the BuilderForce chat`
      : "Code change from the BuilderForce chat";
    try {
      await fromDelta.execute(
        {
          projectId: deps.projectId,
          summary,
          detail:
            "Auto-captured: this chat changed code without recording a ticket, so the platform minted one to keep the work visible on the board and linked to the conversation.",
          files,
          kind: "improvement",
          modality: "ide",
          ...(deps.chatId != null ? { chatId: deps.chatId } : {}),
        },
        deps.root ?? "",
      );
      events.onToolResult("recorded code change as a ticket", true);
    } catch {
      /* backstop is best-effort — never surface an error for it */
    }
  };

  // Keep the board honest about STATUS: when this run CHANGED code, advance any
  // task/epic/gap linked to this chat that is still in a not-started lane
  // (backlog/todo/ready) to in_progress — the IDE twin of the webview loop's
  // status backstop, so "started work on a linked bug ticket but never moved it off
  // backlog" can't happen silently. Best-effort, chat-scoped, never throws. Runs
  // AFTER flushCodeChangeTicket so a freshly-minted review-status ticket isn't touched.
  const flushLinkedTicketProgress = async (): Promise<void> => {
    if (!codeChanged || deps.chatId == null || deps.projectId == null || deps.signal.aborted) return;
    const listTool = toolDefs.find((d) => d.name === "builtin_chats_list_tickets");
    const updateTool = toolDefs.find((d) => d.name === "builtin_tasks_update");
    if (!listTool || !updateTool) return;
    try {
      const listed = await listTool.execute({ chatId: deps.chatId }, deps.root ?? "");
      for (const t of linkedTicketsToAdvance(listed)) {
        const id = Number(t.ref);
        if (!Number.isInteger(id)) continue;
        try {
          await updateTool.execute({ id, status: "in_progress" }, deps.root ?? "");
          events.onToolResult(`advanced ticket #${id} to in progress`, true);
        } catch {
          /* best-effort per ticket */
        }
      }
    } catch {
      /* backstop is best-effort — never surface an error for it */
    }
  };

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

  // The ONE shared, tool-capable streaming client (brain-embedded's
  // streamChatCompletion) — the same transport the web + webview Brain use. The
  // duplicate in-extension SSE parser is retired. Auth, the `vsix` surface tag, and
  // the human-readable gateway error mapping are injected via this BrainTransport;
  // the tool loop and MAX_ITERATIONS below are unchanged.
  const key = await getApiKey(deps.secrets);
  if (!key) {
    events.onError("not_signed_in");
    return;
  }
  const transport: BrainTransport = {
    baseUrl: getBaseUrl(),
    getToken: () => key,
    // Inject the host fetch purely so the `x-builderforce-surface: vsix` header rides
    // every request (streamChatCompletion doesn't set it) — the gateway meters BYO
    // usage from the extension (which runs on the user's own machine) as free off this
    // tag, never charged against the plan allowance. Otherwise the global fetch.
    fetch: (input, reqInit) =>
      fetch(input, {
        ...reqInit,
        headers: {
          ...((reqInit.headers as Record<string, string>) ?? {}),
          "x-builderforce-surface": "vsix",
        },
      }),
    // Preserve the extension's clean gateway-error prose (auth hints, quota, HTTP).
    mapError: async (res) => {
      const txt = await res.text().catch(() => "");
      return new Error(prettyGatewayError(res.status, txt));
    },
  };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (deps.signal.aborted) return;

    let turn: { content: string; toolCalls: RawToolCall[] };
    try {
      // messages carries assistant tool-call turns with `content: null` (valid to the
      // gateway) — the cast is exact; streamChatCompletion only reads the array.
      const result = await streamChatCompletion(
        {
          messages: messages as unknown as ChatCompletionMessage[],
          tools: tools as BrainToolSpec[] | undefined,
          model: deps.model,
          signal: deps.signal,
          transport,
        },
        { onTextDelta: (delta) => events.onText(delta) },
      );
      turn = { content: result.text, toolCalls: result.toolCalls };
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === "AbortError") return;
      events.onError(err.message ?? String(e));
      return;
    }

    if (turn.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: turn.content });
      await flushCodeChangeTicket();
      await flushLinkedTicketProgress();
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
        // Backstop bookkeeping (see flushCodeChangeTicket): a successful workspace
        // file-change marks the run as code-changing; the model recording its own
        // delta/link/review clears the need for the auto-capture.
        if (isCodeChangeTool(def.name)) {
          codeChanged = true;
          const f = codeChangeFile(args);
          if (f && !touchedFiles.includes(f)) touchedFiles.push(f);
        }
        if (isTicketRecordingTool(def.name)) ticketRecorded = true;
      } catch (e) {
        const msg = (e as { message?: string }).message ?? String(e);
        events.onToolResult(`${label} — ${msg}`, false);
        messages.push({ role: "tool", tool_call_id: toolCallId, content: `Error: ${msg}` });
      }
    }
  }

  // Budget exhausted — still guarantee any code changed this run is tied to a ticket
  // AND that worked linked tickets are off the backlog before we surface the dispatch hint.
  await flushCodeChangeTicket();
  await flushLinkedTicketProgress();

  // Hit the inline step budget without finishing — this is the signal the job is too
  // large for an in-editor chat. Point at the dispatch path (persona's handoff
  // strategy) instead of dead-ending, so the next turn can create + assign a task.
  events.onError(
    `Reached the in-editor step limit (${MAX_ITERATIONS} tool calls) before finishing. ` +
      `This job is large for an inline chat — ask me to dispatch it to the platform ` +
      `(I'll create a task with the full instructions and assign a cloud agent to run it to completion), ` +
      `or narrow the scope.`,
  );
}
