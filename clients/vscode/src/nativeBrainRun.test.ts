/**
 * The native `@builderforce` participant, running on the REAL shared loop.
 *
 * These are the checks from PRD §2.5 that do not need a live Extension Development
 * Host: everything between "the model emitted this" and "the participant streamed
 * that" is deterministic once the gateway is scripted (see `harness/fakeGateway`), so
 * approvals, governance gates, both board backstops, the memory-first short-circuit
 * and the tool-budget dispatch hint are all reachable offline. What genuinely is NOT
 * reachable here — a real `ChatResponseStream`, a real modal, real files on disk — is
 * named in each case below rather than faked into a false pass.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBrainRunStore, type EvermindRunHooks } from "@seanhogg/builderforce-brain-embedded";
import { fakeGateway, type GatewayScript } from "../harness/fakeGateway";
import type { ToolDef } from "./fileTools";
import type { PolicyGate } from "./policy";
import {
  createNativeStream,
  createStreamRelay,
  exhaustedToolBudget,
  nativeNeedsConfirm,
  parseToolOutput,
  runNativeBrain,
  SURFACE_HEADER,
  SURFACE_VALUE,
  toolLabel,
  transientRunPersistence,
  unlinkedRunId,
  type NativeApprovalRequest,
  type NativeRunEvents,
} from "./nativeBrainRun";

const LABELS = {
  dispatchHint: "[dispatch hint]",
  blockedByPolicy: (reason: string) => `Blocked by a governance gate: ${reason}`,
};

/** A tool def with a recording executor, in the extension's real `ToolDef` shape. */
function toolDef(
  name: string,
  opts: { mutating?: boolean; remote?: boolean; result?: unknown; throws?: string } = {},
): ToolDef & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: "object", properties: {} },
    mutating: opts.mutating ?? false,
    ...(opts.remote ? { remote: true } : {}),
    calls,
    async execute(args) {
      calls.push(args);
      if (opts.throws) throw new Error(opts.throws);
      return JSON.stringify(opts.result ?? { ok: true });
    },
  };
}

interface Recorded {
  text: string;
  toolStarts: string[];
  toolResults: Array<{ label: string; ok: boolean }>;
  errors: string[];
}

function recorder(): { events: NativeRunEvents; log: Recorded } {
  const log: Recorded = { text: "", toolStarts: [], toolResults: [], errors: [] };
  return {
    log,
    events: {
      onText: (d) => { log.text += d; },
      onToolStart: (l) => log.toolStarts.push(l),
      onToolResult: (label, ok) => log.toolResults.push({ label, ok }),
      onError: (m) => log.errors.push(m),
    },
  };
}

let nextChatId = 1000;
function freshChatId(): number {
  nextChatId += 1;
  return nextChatId;
}

/** Drive one native turn against a scripted gateway. */
async function runTurn(opts: {
  script: GatewayScript;
  tools?: ToolDef[];
  approve?: (req: NativeApprovalRequest) => Promise<boolean>;
  permissionMode?: "ask" | "acceptEdits";
  policyGates?: PolicyGate[];
  projectId?: number;
  evermind?: EvermindRunHooks;
  maxIterations?: number;
  chatId?: number;
  prompt?: string;
}) {
  const gateway = fakeGateway(opts.script);
  const { events, log } = recorder();
  const approvals: NativeApprovalRequest[] = [];
  const chatId = opts.chatId ?? freshChatId();
  await runNativeBrain({
    chatId,
    systemPrompt: "You are the BuilderForce IDE agent.",
    seed: [],
    userTurn: opts.prompt ?? "what does this project do?",
    tools: opts.tools ?? [],
    root: "/workspace",
    ...(opts.projectId != null ? { projectId: opts.projectId } : {}),
    ...(opts.evermind ? { evermind: opts.evermind } : {}),
    ...(opts.policyGates ? { policyGates: opts.policyGates } : {}),
    ...(opts.maxIterations ? { maxIterations: opts.maxIterations } : {}),
    permissionMode: opts.permissionMode ?? "ask",
    approve: async (req) => {
      approvals.push(req);
      return opts.approve ? opts.approve(req) : true;
    },
    stream: gateway.stream,
    persistence: transientRunPersistence(),
    signal: new AbortController().signal,
    labels: LABELS,
    events,
  });
  return { log, approvals, requests: gateway.requests, chatId };
}

beforeEach(() => {
  resetBrainRunStore();
});

// ── §2.5 #1 — a plain Q&A turn streams tokens ────────────────────────────────
// COVERED offline: the deltas the participant would hand `stream.markdown`. NOT covered:
// that VS Code renders them (a live host renders the ChatResponseStream, not us).
describe("a plain Q&A turn", () => {
  it("streams the answer once — no duplicate final block when the loop commits it", async () => {
    const { log, requests } = await runTurn({ script: [{ text: "It is a monorepo." }] });

    expect(log.text).toBe("It is a monorepo.");
    expect(requests).toHaveLength(1);
    expect(log.errors).toEqual([]);
  });

  it("streams narration from a tool turn AND the final answer, each exactly once", async () => {
    const read = toolDef("read_file", { result: { content: "hi" } });
    const { log } = await runTurn({
      tools: [read],
      script: (ctx) =>
        ctx.turn === 0
          ? { text: "Reading the file.", toolCalls: [{ name: "read_file", args: { path: "a.ts" } }] }
          : { text: "It says hi." },
    });

    expect(log.text.match(/Reading the file\./g)).toHaveLength(1);
    expect(log.text.match(/It says hi\./g)).toHaveLength(1);
    expect(log.text.indexOf("Reading the file.")).toBeLessThan(log.text.indexOf("It says hi."));
  });
});

// ── §2.5 #2 — an edit turn asks for approval, applies on yes, skips on no ─────
// COVERED offline: the gate, the decision reaching the tool, and what the model is told
// when declined. NOT covered: `vscode.window.showWarningMessage`'s actual modal.
describe("a workspace edit", () => {
  it("pauses for approval and runs the tool when the human approves", async () => {
    const write = toolDef("write_file", { mutating: true });
    const { log, approvals } = await runTurn({
      tools: [write],
      approve: async () => true,
      script: (ctx) =>
        ctx.turn === 0
          ? { toolCalls: [{ name: "write_file", args: { path: "src/app.ts" } }] }
          : { text: "Done." },
    });

    expect(approvals.map((a) => a.label)).toEqual(["write src/app.ts"]);
    expect(write.calls).toHaveLength(1);
    expect(log.toolResults).toContainEqual({ label: "write src/app.ts", ok: true });
  });

  it("skips the tool when the human declines, and tells the model it was declined", async () => {
    const write = toolDef("write_file", { mutating: true });
    const toolResults: string[] = [];
    await runTurn({
      tools: [write],
      approve: async () => false,
      script: (ctx) => {
        // Capture what the model is told about its own call on the follow-up turn: a
        // silent skip would let it report an edit that never happened.
        for (const m of ctx.messages) if (m.role === "tool") toolResults.push(String(m.content));
        return ctx.turn === 0
          ? { toolCalls: [{ name: "write_file", args: { path: "src/app.ts" } }] }
          : { text: "Understood." };
      },
    });

    expect(write.calls).toHaveLength(0);
    expect(toolResults.join("\n")).toContain("User declined this action.");
  });

  it("does not pause for a read-only tool", async () => {
    const read = toolDef("read_file");
    const { approvals } = await runTurn({
      tools: [read],
      script: (ctx) => (ctx.turn === 0 ? { toolCalls: [{ name: "read_file", args: { path: "a.ts" } }] } : { text: "ok" }),
    });
    expect(approvals).toEqual([]);
    expect(read.calls).toHaveLength(1);
  });
});

// ── §2.5 #3 — the two board backstops fire for the native host too ────────────
// COVERED offline: both post-run backstops dispatching through the host's own tool
// dispatcher, which is the thing the migration had to prove (they used to be a second,
// native-only copy). NOT covered: that the server actually mints the row.
describe("a code-changing turn that never records a ticket", () => {
  it("mints one via from_delta and advances the linked backlog ticket", async () => {
    const edit = toolDef("edit_file", { mutating: true });
    const fromDelta = toolDef("builtin_tickets_from_delta", { mutating: true, remote: true, result: { id: 7 } });
    const listTickets = toolDef("builtin_chats_list_tickets", {
      remote: true,
      result: [{ kind: "task", ref: "42", status: "backlog" }],
    });
    const update = toolDef("builtin_tasks_update", { mutating: true, remote: true, result: { id: 42 } });

    await runTurn({
      tools: [edit, fromDelta, listTickets, update],
      projectId: 5,
      permissionMode: "acceptEdits",
      script: (ctx) =>
        ctx.turn === 0
          ? { toolCalls: [{ name: "edit_file", args: { path: "src/app.ts" } }] }
          : { text: "Edited." },
    });

    expect(fromDelta.calls).toHaveLength(1);
    expect(fromDelta.calls[0]).toMatchObject({ projectId: 5, files: ["src/app.ts"], modality: "ide" });
    expect(update.calls).toEqual([{ id: 42, status: "in_progress" }]);
  });

  it("stays quiet when the model recorded the ticket itself", async () => {
    const edit = toolDef("edit_file", { mutating: true });
    const fromDelta = toolDef("builtin_tickets_from_delta", { mutating: true, remote: true, result: { id: 7 } });
    const listTickets = toolDef("builtin_chats_list_tickets", { remote: true, result: [] });
    const update = toolDef("builtin_tasks_update", { mutating: true, remote: true });

    await runTurn({
      tools: [edit, fromDelta, listTickets, update],
      projectId: 5,
      permissionMode: "acceptEdits",
      script: (ctx) => {
        if (ctx.turn === 0) return { toolCalls: [{ name: "edit_file", args: { path: "src/app.ts" } }] };
        if (ctx.turn === 1) {
          return { toolCalls: [{ name: "builtin_tickets_from_delta", args: { projectId: 5, summary: "did a thing" } }] };
        }
        return { text: "Edited and recorded." };
      },
    });

    // Once — the model's own call. The backstop must not add a second.
    expect(fromDelta.calls).toHaveLength(1);
    expect(update.calls).toHaveLength(0);
  });
});

// ── §2.5 #4 — governance gates at the tool seam ──────────────────────────────
// COVERED offline in full: the seam is a pure decision over the host's dispatcher.
describe("a governance gate", () => {
  it("blocks the call before it reaches the implementation and tells the model why", async () => {
    const run = toolDef("run_command", { mutating: true });
    const gates: PolicyGate[] = [{ id: "no-shell", tool: "run_command", effect: "block", reason: "shell is off-limits" }];
    const { log, requests } = await runTurn({
      tools: [run],
      policyGates: gates,
      permissionMode: "acceptEdits",
      script: (ctx) =>
        ctx.turn === 0 ? { toolCalls: [{ name: "run_command", args: { command: "rm -rf /" } }] } : { text: "I cannot." },
    });

    expect(run.calls).toHaveLength(0);
    expect(log.toolResults.some((r) => !r.ok)).toBe(true);
    // The refusal is a recoverable tool result, so the run continues to an answer.
    expect(requests).toHaveLength(2);
    expect(log.text).toContain("I cannot.");
  });

  it("renders its directives into the system prompt the model actually reads", async () => {
    const gates: PolicyGate[] = [{ id: "no-shell", tool: "run_command", effect: "block", reason: "shell is off-limits" }];
    let systemPrompt = "";
    await runTurn({
      script: (ctx) => {
        systemPrompt = String(ctx.messages.find((m) => m.role === "system")?.content ?? "");
        return { text: "ok" };
      },
      policyGates: gates,
    });

    expect(systemPrompt).toContain("Governance (these gates are binding)");
    expect(systemPrompt).toContain("shell is off-limits");
    // The host's own prompt survives alongside it.
    expect(systemPrompt).toContain("You are the BuilderForce IDE agent.");
  });

  it("requires approval even when the user set acceptEdits", async () => {
    const gates: PolicyGate[] = [
      { id: "review-writes", tool: "write_file", effect: "require-approval", reason: "writes need a reviewer" },
    ];
    const write = toolDef("write_file", { mutating: true });
    const { approvals } = await runTurn({
      tools: [write],
      policyGates: gates,
      permissionMode: "acceptEdits",
      approve: async () => true,
      script: (ctx) =>
        ctx.turn === 0 ? { toolCalls: [{ name: "write_file", args: { path: "a.ts" } }] } : { text: "done" },
    });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.gateReason).toBe("writes need a reviewer");
  });
});

// ── §2.5 #5 — the payoff: memory answers, the model is never called ──────────
// COVERED offline in full: "was the gateway called at all" is exactly what the fake
// gateway records.
describe("the memory-first short-circuit", () => {
  it("answers a repeat question with NO model call", async () => {
    const answer = vi.fn(async () => ({ text: "It is a monorepo.", source: "qa-cache" as const }));
    const cacheAnswer = vi.fn();
    const { log, requests } = await runTurn({
      script: [{ text: "SHOULD NEVER BE STREAMED" }],
      projectId: 5,
      evermind: { recall: async () => null, answer, cacheAnswer },
    });

    expect(requests).toHaveLength(0); // the whole point: zero paid completions
    expect(log.text).toContain("It is a monorepo.");
    expect(log.text).not.toContain("SHOULD NEVER BE STREAMED");
    // A replayed answer is already in the cache; re-writing it would be a wasted call.
    expect(cacheAnswer).not.toHaveBeenCalled();
  });

  it("falls through to the model on a miss, and caches the fresh answer", async () => {
    const cacheAnswer = vi.fn();
    const { log, requests } = await runTurn({
      script: [{ text: "It is a monorepo of eight packages." }],
      projectId: 5,
      evermind: { recall: async () => null, answer: async () => null, cacheAnswer },
    });

    expect(requests).toHaveLength(1);
    expect(log.text).toBe("It is a monorepo of eight packages.");
    expect(cacheAnswer).toHaveBeenCalledWith("what does this project do?", "It is a monorepo of eight packages.");
  });

  it("declares tools HONESTLY so the SSM leg cannot pre-empt a tool-answerable question", async () => {
    const answer = vi.fn(async () => null);
    await runTurn({
      script: [{ text: "…" }],
      projectId: 5,
      tools: [toolDef("builtin_tasks_list", { remote: true })],
      evermind: { recall: async () => null, answer, cacheAnswer: () => {} },
    });
    expect(answer).toHaveBeenCalledWith("what does this project do?", { toolsAvailable: true });
  });

  it("injects recalled memories into the prompt without blocking on a failure", async () => {
    const { log } = await runTurn({
      script: [{ text: "answered" }],
      projectId: 5,
      evermind: {
        recall: async () => {
          throw new Error("recall is down");
        },
      },
    });
    expect(log.text).toBe("answered");
    expect(log.errors).toEqual([]);
  });
});

// ── §2.5 #7 — the tool budget, and the dispatch hint on exhaustion ───────────
describe("a run that burns its tool budget", () => {
  it("stops at the injected ceiling and appends the dispatch hint", async () => {
    const read = toolDef("read_file", { result: { content: "…" } });
    const { log, requests } = await runTurn({
      tools: [read],
      maxIterations: 2,
      permissionMode: "acceptEdits",
      script: (ctx) =>
        ctx.toolless
          ? { text: "Here is what I found so far." }
          : { toolCalls: [{ name: "read_file", args: { path: `f${ctx.turn}.ts` } }] },
    });

    // Two tool turns, then the loop's forced final synthesis with tools withdrawn.
    expect(requests).toHaveLength(3);
    expect(requests[2]?.toolless).toBe(true);
    expect(log.text).toContain("Here is what I found so far.");
    expect(log.text).toContain(LABELS.dispatchHint);
  });

  it("does not append the hint to a run that finished normally", async () => {
    const { log } = await runTurn({ script: [{ text: "Done." }] });
    expect(log.text).not.toContain(LABELS.dispatchHint);
  });
});

// ── The pure seams the migration introduced ──────────────────────────────────
describe("toolLabel", () => {
  const defs = [toolDef("write_file", { mutating: true }), toolDef("builtin_tasks_create", { remote: true })];

  it("uses the local phrasing for a workspace tool", () => {
    expect(toolLabel(defs, "write_file", { path: "src/a.ts" })).toBe("write src/a.ts");
  });

  it("uses the verb-plus-subject phrasing for a platform tool", () => {
    expect(toolLabel(defs, "builtin_tasks_create", { title: "Ship it" })).toBe("tasks create: Ship it");
    expect(toolLabel(defs, "builtin_tasks_create", {})).toBe("tasks create");
  });
});

describe("nativeNeedsConfirm", () => {
  const defs = [toolDef("write_file", { mutating: true }), toolDef("read_file")];

  it("pauses on a mutating tool in ask mode and not in acceptEdits", () => {
    expect(nativeNeedsConfirm(defs, "ask", undefined)({ name: "write_file", args: {} })).toBe(true);
    expect(nativeNeedsConfirm(defs, "acceptEdits", undefined)({ name: "write_file", args: {} })).toBe(false);
  });

  it("never pauses on a read-only tool", () => {
    expect(nativeNeedsConfirm(defs, "ask", undefined)({ name: "read_file", args: {} })).toBe(false);
  });

  it("treats an unknown tool as mutating", () => {
    expect(nativeNeedsConfirm(defs, "ask", undefined)({ name: "mystery", args: {} })).toBe(true);
  });
});

describe("parseToolOutput", () => {
  it("parses a JSON envelope so the loop can see ok:false and a created id", () => {
    expect(parseToolOutput('{"ok":false,"error":"nope"}')).toEqual({ ok: false, error: "nope" });
    expect(parseToolOutput("[{\"id\":1}]")).toEqual([{ id: 1 }]);
  });

  it("leaves prose alone", () => {
    expect(parseToolOutput("wrote 3 lines")).toBe("wrote 3 lines");
    expect(parseToolOutput("{not json")).toBe("{not json");
  });
});

describe("createStreamRelay", () => {
  const snapshot = (streamingText: string, appended: Array<{ id: number; content: string }>) =>
    ({ streamingText, appended } as never);

  it("emits streamed deltas once and skips the committed twin", () => {
    let text = "";
    const relay = createStreamRelay({ onText: (d) => { text += d; } });
    relay(snapshot("Hel", []));
    relay(snapshot("Hello", []));
    relay(snapshot("Hello", [{ id: -1, content: "Hello" }]));
    relay(snapshot("", [{ id: -1, content: "Hello" }]));
    expect(text).toBe("Hello");
  });

  it("emits a message that was never streamed — the memory-first answer", () => {
    let text = "";
    const relay = createStreamRelay({ onText: (d) => { text += d; } });
    relay(snapshot("", [{ id: -1, content: "From memory." }]));
    expect(text.trim()).toBe("From memory.");
  });
});

describe("exhaustedToolBudget", () => {
  it("recognises the forced final synthesis and the give-up step", () => {
    expect(exhaustedToolBudget([{ ts: "", category: "llm", label: "llm.complete", args: { forcedFinish: true } }])).toBe(true);
    expect(exhaustedToolBudget([{ ts: "", category: "error", label: "agent.loop", isError: true }])).toBe(true);
    expect(exhaustedToolBudget([{ ts: "", category: "llm", label: "llm.complete", args: { step: 0 } }])).toBe(false);
  });
});

describe("createNativeStream", () => {
  it("tags every completion with the vsix surface header so metering attributes it", async () => {
    const seen: Array<Record<string, string>> = [];
    const stream = createNativeStream("https://gateway.test", "key-123", async (_input, init) => {
      seen.push(init.headers as Record<string, string>);
      // An empty SSE body is enough: we are asserting the REQUEST, not the parse.
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    await stream({ messages: [{ role: "user", content: "hi" }] });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[SURFACE_HEADER]).toBe(SURFACE_VALUE);
    expect(seen[0]?.Authorization).toBe("Bearer key-123");
  });
});

describe("chat ⇄ work linking", () => {
  it("comes from the SHARED loop — the native host no longer injects its own copy", async () => {
    let systemPrompt = "";
    const chatId = freshChatId();
    await runTurn({
      chatId,
      script: (ctx) => {
        systemPrompt = String(ctx.messages.find((m) => m.role === "system")?.content ?? "");
        return { text: "ok" };
      },
    });

    // The loop's WORK-mode directive names this run's chat id, which is what makes the
    // chat-scoped tools usable. Two copies of it would be the duplication this pass removed.
    expect(systemPrompt).toContain(`chatId=${chatId}`);
    expect(systemPrompt.match(/MODE: WORK/g)).toHaveLength(1);
  });
});

describe("unlinkedRunId", () => {
  it("hands out a distinct negative cell key per unlinked turn", () => {
    const a = unlinkedRunId();
    const b = unlinkedRunId();
    expect(a).toBeLessThan(0);
    expect(b).toBeLessThan(0);
    expect(a).not.toBe(b);
  });
});

describe("transientRunPersistence", () => {
  it("mints negative ids so an in-run write is never mistaken for a stored message", async () => {
    const p = transientRunPersistence();
    const [one, two] = await p.sendMessages(1, [
      { role: "assistant", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    expect(one?.id).toBeLessThan(0);
    expect(two?.id).toBeLessThan(0);
    expect(one?.id).not.toBe(two?.id);
    expect(one?.content).toBe("a");
  });
});
