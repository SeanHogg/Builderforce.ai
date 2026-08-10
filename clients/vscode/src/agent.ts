import * as vscode from "vscode";
import {
  chatWorkLinkingDirective,
  isCodeChangeTool,
  isTicketRecordingTool,
  codeChangeFile,
  linkedTicketsToAdvance,
} from "@seanhogg/builderforce-brain-embedded";
import { ChatMessage, getApiKey, getBaseUrl } from "./gateway";
import { TOOL_DEFS, type ToolDef } from "./fileTools";
import { listPlatformTools } from "./platformTools";
import { cognitionToolDefs, recallSystemMessage } from "./cognition";
import { renderPolicyDirectives, type PolicyGate } from "./policy";
import { runClaudeSdkAgent } from "./claudeSdkAgent";

export interface AgentEvents {
  onText: (delta: string) => void;
  onToolStart: (label: string) => void;
  onToolResult: (label: string, ok: boolean) => void;
  /**
   * A run failed. `cause` is the original thrown value when there was one — a
   * gateway failure arrives as a `BrainRequestError` carrying the structured
   * entitlement fields, which is what lets a surface offer "Upgrade" / "Add a
   * card" instead of only restating the message. Consumers that just print text
   * can ignore it.
   */
  onError: (message: string, cause?: unknown) => void;
}

export interface AgentDeps {
  secrets: vscode.SecretStorage;
  /** Workspace root. When undefined, file tools are disabled (chat-only). */
  root?: string;
  /** Extension-owned Claude SDK state directory (never the user's ~/.claude). */
  sdkConfigDir: string;
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
  modelStrict?: boolean;
  routingMode?: "auto" | "byo_pool";
  permissionMode: "ask" | "acceptEdits";
  /** Returns true if the user approves a mutating tool call. */
  approve: (summary: string) => Promise<boolean>;
  signal: AbortSignal;
  /** Compiled governance gates (compile-primitive policy modality). Enforced at the
   *  tool seam exactly as the cloud loop enforces them, so a gate authored on the
   *  agent's spec governs the IDE run identically. */
  policyGates?: PolicyGate[];
}

/**
 * Run the native participant through the Claude Agent SDK. Claude Code owns the
 * coding loop and native workspace tools; BuilderForce's platform and cognition
 * tools are exposed through an in-process MCP server.
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
  const cognitionTools = deps.projectId ? cognitionToolDefs(deps.secrets, deps.projectId) : [];
  const localTools: ToolDef[] = [...(deps.root ? TOOL_DEFS : []), ...cognitionTools];
  const platformTools = await listPlatformTools(deps.secrets);
  const toolDefs: ToolDef[] = [...localTools, ...platformTools];
  // Native Claude Code tools replace the shared file-tool facade for execution.
  // Only app-specific tools cross the MCP seam; keep the full catalog available
  // for deterministic backstops below, while the SDK defers it behind tool search.
  const sdkTools: ToolDef[] = [...cognitionTools, ...platformTools];

  // Governance: render the gate directives into a leading system block so the model
  // is bound by the same policy on every surface; hard enforcement is at the tool
  // seam below. `policyAsked` tracks require-approval gates already approved this run.
  const governance = renderPolicyDirectives(deps.policyGates);
  if (governance) messages.unshift({ role: "system", content: governance });

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

  const key = await getApiKey(deps.secrets);
  if (!key) {
    events.onError("not_signed_in");
    return;
  }
  const abortController = new AbortController();
  if (deps.signal.aborted) abortController.abort();
  else deps.signal.addEventListener("abort", () => abortController.abort(), { once: true });

  await runClaudeSdkAgent({
    messages,
    tools: sdkTools,
    cwd: deps.root,
    configDir: deps.sdkConfigDir,
    baseUrl: getBaseUrl(),
    apiKey: key,
    model: deps.model,
    permissionMode: deps.permissionMode,
    policyGates: deps.policyGates,
    approve: deps.approve,
    abortController,
    events,
    onToolSucceeded: (name, args) => {
      if (isCodeChangeTool(name)) {
        codeChanged = true;
        const f = codeChangeFile(args) ?? (typeof args.file_path === "string" ? args.file_path : undefined);
        if (f && !touchedFiles.includes(f)) touchedFiles.push(f);
      }
      if (isTicketRecordingTool(name)) ticketRecorded = true;
    },
  });

  // Preserve BuilderForce's deterministic product invariants around the SDK loop.
  await flushCodeChangeTicket();
  await flushLinkedTicketProgress();
}
