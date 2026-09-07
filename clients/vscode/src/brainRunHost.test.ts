/**
 * The host-owned Brain run, on the REAL shared loop against a scripted gateway.
 *
 * What these prove is the contract the webview relies on now that its runs execute
 * in the extension host: a run keeps going with NO panel attached; a panel attached
 * mid-run (a reopened tab) is brought up to date; the trace is relayed as a delta;
 * tool calls are executed by the host's own catalog and announced; the confirm gate
 * follows the panel's switch live; and a persist failure surfaces as the run's error
 * rather than as a hang.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRemoteRun,
  getRunSnapshot,
  getRunTrace,
  isRunning,
  resetBrainRunStore,
  type BrainRunSnapshot,
  type BrainStreamFn,
} from "@seanhogg/builderforce-brain-embedded";
import { fakeGateway, type GatewayScript } from "../harness/fakeGateway";
import type { ToolDef } from "./fileTools";
import { createBrainRunHost, syncMessageFor, type BrainRunHostPorts, type RunHostMessage, type SinkEntry } from "./brainRunHost";
import { transientRunPersistence } from "./nativeBrainRun";

function toolDef(name: string, opts: { mutating?: boolean; remote?: boolean; result?: unknown } = {}): ToolDef & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: "object", properties: {} },
    mutating: opts.mutating ?? false,
    ...(opts.remote ? { remote: true } : {}),
    calls,
    async execute(args) {
      calls.push(args);
      return JSON.stringify(opts.result ?? { ok: true, content: "hello" });
    },
  };
}

let nextChatId = 5000;
const freshChatId = (): number => (nextChatId += 1);

function ports(
  over: Partial<Omit<BrainRunHostPorts, "tools">> & { script: GatewayScript; tools?: ToolDef[] },
): BrainRunHostPorts {
  const { script, tools, ...rest } = over;
  const gateway = fakeGateway(script);
  return {
    tools: async () => tools ?? [],
    workspaceRoot: () => "/workspace",
    stream: async () => gateway.stream as unknown as BrainStreamFn,
    persistence: transientRunPersistence(),
    evermind: () => undefined,
    labels: { blockedByPolicy: (r) => `blocked: ${r}` },
    ...rest,
  };
}

function start(chatId: number, host: ReturnType<typeof createBrainRunHost>, over: Partial<Parameters<typeof host.start>[0]> = {}) {
  return host.start({
    chatId,
    systemPrompt: "You are the BuilderForce IDE agent.",
    userTurn: "what does this project do?",
    autoApprove: true,
    evermind: false,
    ...over,
  });
}

/** A sink that records every frame, like a panel would. */
function sink(): { post: (m: RunHostMessage) => void; frames: RunHostMessage[] } {
  const frames: RunHostMessage[] = [];
  return { post: (m) => frames.push(m), frames };
}

beforeEach(() => {
  resetBrainRunStore();
});

describe("project memory in a host-owned run", () => {
  it("appends the api run context (facts, PRD, governance) to the system prompt, recalled with the user's request", async () => {
    const chatId = freshChatId();
    let systemSeen = "";
    const runContext = vi.fn(async () => "## Platform context\nProject memory: the chat list is served by GET /api/brain/chats.");
    const host = createBrainRunHost(
      ports({
        script: (ctx) => {
          systemSeen = String(ctx.messages[0]?.content ?? "");
          return { text: "It comes from /api/brain/chats." };
        },
        runContext,
      }),
    );
    await start(chatId, host, { projectId: 11, userTurn: "where does the chat list get its data?" });
    expect(runContext).toHaveBeenCalledWith(11, chatId, "where does the chat list get its data?");
    expect(systemSeen).toContain("You are the BuilderForce IDE agent.");
    expect(systemSeen).toContain("GET /api/brain/chats");
  });

  it("asks for no context on a run with no project — there is no memory to recall", async () => {
    const chatId = freshChatId();
    const runContext = vi.fn(async () => "never");
    const host = createBrainRunHost(ports({ script: [{ text: "ok" }], runContext }));
    await start(chatId, host);
    expect(runContext).not.toHaveBeenCalled();
  });
});

describe("a run with no panel attached", () => {
  it("runs to completion in the host and settles", async () => {
    const chatId = freshChatId();
    const host = createBrainRunHost(ports({ script: [{ text: "It is a monorepo." }] }));
    await start(chatId, host);
    expect(isRunning(chatId)).toBe(false);
    expect(getRunSnapshot(chatId).appended.map((m) => m.content)).toEqual(["It is a monorepo."]);
  });

  it("brings a panel that attaches AFTER the run up to date, and settles it on the same frame stream", async () => {
    const chatId = freshChatId();
    const host = createBrainRunHost(ports({ script: [{ text: "Done." }] }));
    await start(chatId, host);
    const s = sink();
    host.attach(s);
    const sync = s.frames.find((f) => f.type === "run.sync");
    expect(sync && sync.type === "run.sync" && sync.chatId).toBe(chatId);
    expect(sync && sync.type === "run.sync" && sync.traceFrom).toBe(0);
    expect(sync && sync.type === "run.sync" && sync.snapshot.appended[0]?.content).toBe("Done.");
  });
});

describe("the relay", () => {
  it("streams every store change to an attached panel and closes with run.settled", async () => {
    const chatId = freshChatId();
    const host = createBrainRunHost(ports({ script: [{ text: "Streamed reply." }] }));
    const s = sink();
    host.attach(s);
    await start(chatId, host);
    const types = s.frames.map((f) => f.type);
    expect(types[0]).toBe("run.tools");
    expect(types).toContain("run.sync");
    expect(types[types.length - 1]).toBe("run.settled");
    const syncs = s.frames.filter((f): f is Extract<RunHostMessage, { type: "run.sync" }> => f.type === "run.sync");
    // The first sync carried the run as live; the last one carries it settled.
    expect(syncs[0].snapshot.running).toBe(true);
    expect(syncs[syncs.length - 1].snapshot.running).toBe(false);
  });

  it("ships the trace as a delta, and a mirror rebuilt from the deltas equals the host trace", async () => {
    const chatId = freshChatId();
    const read = toolDef("read_file");
    const host = createBrainRunHost(
      ports({
        tools: [read],
        script: [{ toolCalls: [{ name: "read_file", args: { path: "a.ts" } }] }, { text: "Read it." }],
      }),
    );
    const s = sink();
    host.attach(s);
    await start(chatId, host);
    // Replay the frames into a second store cell exactly as the webview driver does.
    const mirrorId = chatId + 100000;
    for (const f of s.frames) {
      if (f.type !== "run.sync") continue;
      const prior = getRunTrace(mirrorId);
      const trace = f.traceFrom > 0 ? [...prior.slice(0, f.traceFrom), ...f.trace] : f.trace;
      applyRemoteRun(mirrorId, { ...f.snapshot, trace, hasTrace: trace.length > 0 } as BrainRunSnapshot);
    }
    expect(getRunTrace(mirrorId)).toEqual(getRunTrace(chatId));
    expect(getRunTrace(mirrorId).length).toBeGreaterThan(0);
    // At least one frame after the first was a true delta (not a full resend).
    const syncs = s.frames.filter((f): f is Extract<RunHostMessage, { type: "run.sync" }> => f.type === "run.sync");
    expect(syncs.some((f) => f.traceFrom > 0)).toBe(true);
  });

  it("resends the whole trace to a sink whose bookkeeping no longer matches the head", () => {
    const chatId = freshChatId();
    const ev = (label: string) => ({ ts: "t", category: "tool" as const, label, result: "ok" });
    applyRemoteRun(chatId, {
      running: false, streamingText: "", error: "", errorAction: null, pendingConfirm: null, messagesEpoch: 0,
      appended: [], hasTrace: true, trace: [ev("a"), ev("b")], activity: null, byoUnresolved: [], providerCap: [],
    });
    const entry: SinkEntry = { sink: { post: () => undefined }, sent: new Map() };
    expect(syncMessageFor(entry, chatId).traceFrom).toBe(0);
    // Nothing new: an empty delta continuing from the end.
    const again = syncMessageFor(entry, chatId);
    expect(again.traceFrom).toBe(2);
    expect(again.trace).toEqual([]);
    // The head moved (the store trimmed its bound): full resync.
    entry.sent.set(chatId, { len: 2, first: ev("zzz") });
    expect(syncMessageFor(entry, chatId).traceFrom).toBe(0);
  });
});

describe("tools", () => {
  it("executes the host's catalog and announces each call with its kind and outcome", async () => {
    const chatId = freshChatId();
    const edit = toolDef("edit_file", { mutating: true });
    const create = toolDef("builtin_tasks_create", { mutating: true, remote: true, result: { ok: true, id: 7 } });
    const onToolRun = vi.fn();
    const host = createBrainRunHost(
      ports({
        tools: [edit, create],
        onToolRun,
        script: [
          { toolCalls: [{ name: "edit_file", args: { path: "a.ts", old_string: "x", new_string: "y" } }] },
          { toolCalls: [{ name: "builtin_tasks_create", args: { title: "t" } }] },
          { text: "Both done." },
        ],
      }),
    );
    const s = sink();
    host.attach(s);
    await start(chatId, host);
    expect(edit.calls).toHaveLength(1);
    expect(create.calls).toHaveLength(1);
    const announced = s.frames.filter((f): f is Extract<RunHostMessage, { type: "run.tool" }> => f.type === "run.tool");
    expect(announced.map((f) => [f.name, f.mutating, f.remote, f.ok])).toEqual([
      ["edit_file", true, false, true],
      ["builtin_tasks_create", true, true, true],
    ]);
    expect(onToolRun).toHaveBeenCalledTimes(2);
  });

  it("writes the session note for local activity once the run settles", async () => {
    const chatId = freshChatId();
    const sessionNote = vi.fn(async () => undefined);
    const host = createBrainRunHost(
      ports({
        tools: [toolDef("write_file", { mutating: true })],
        sessionNote,
        script: [{ toolCalls: [{ name: "write_file", args: { path: "new.ts", content: "x" } }] }, { text: "Written." }],
      }),
    );
    await start(chatId, host);
    expect(sessionNote).toHaveBeenCalledTimes(1);
    expect(sessionNote).toHaveBeenCalledWith(chatId, expect.anything());
  });
});

/**
 * The reason runs live in the host at all: the user switches chats, and the work behind
 * the tab they left carries on. Two conversations in flight at once must not be able to
 * touch each other's transcript, tools or gate.
 */
describe("two chats at once", () => {
  it("runs them in parallel — neither waits for the other, and neither sees the other's turns", async () => {
    const refactor = freshChatId();
    const question = freshChatId();
    // The refactor's tool parks until we release it; the question's answers at once.
    let release = (): void => undefined;
    const blocked = new Promise<void>((r) => { release = r; });
    const slow = toolDef("edit_file", { mutating: true });
    slow.execute = async (args) => { slow.calls.push(args); await blocked; return JSON.stringify({ ok: true }); };
    const fast = toolDef("read_file");
    const host = createBrainRunHost(
      ports({
        tools: [slow, fast],
        // One gateway serving both chats, deciding from the transcript it is handed —
        // which is also the assertion that the two transcripts never merged.
        script: (ctx) => {
          const mine = ctx.messages.some((m) => m.role === "user" && String(m.content).includes("refactor"));
          if (ctx.messages.some((m) => m.role === "tool")) return { text: mine ? "Refactored." : "Explained." };
          return { toolCalls: [{ name: mine ? "edit_file" : "read_file", args: { path: "a.ts" } }] };
        },
      }),
    );
    const slowRun = start(refactor, host, { userTurn: "refactor the parser" });
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1));
    // The second chat starts and FINISHES while the first is still inside its tool.
    await start(question, host, { userTurn: "explain the parser" });
    expect(isRunning(question)).toBe(false);
    expect(isRunning(refactor)).toBe(true);
    expect(getRunSnapshot(question).appended.at(-1)?.content).toBe("Explained.");
    release();
    await slowRun;
    expect(getRunSnapshot(refactor).appended.at(-1)?.content).toBe("Refactored.");
    // Each conversation kept its own tool call; nothing crossed over.
    expect(slow.calls).toHaveLength(1);
    expect(fast.calls).toHaveLength(1);
  });

  it("tells each chat's tool calls which model served THAT chat", async () => {
    // `builtin_session_current_model` is answered from the client, because an MCP call is
    // a separate request that cannot see which model the gateway picked. While that was
    // one process-wide slot, the chat that finished LAST answered for both — the tool
    // that exists to be authoritative about the conversation, confidently naming another
    // one's model. It also never reached the editor at all: the shaping lived in the web
    // relay, and the VSIX has its own.
    const a = freshChatId();
    const b = freshChatId();
    const asked = toolDef("builtin_session_current_model", { remote: true });
    const host = createBrainRunHost(
      ports({
        tools: [asked],
        script: (ctx) => {
          const mine = ctx.messages.some((m) => m.role === "user" && String(m.content).includes("grok"));
          if (ctx.messages.some((m) => m.role === "tool")) return { text: "Told you." };
          return { resolvedModel: mine ? "xai-oauth/grok-4.5" : "direct/minimax/MiniMax-M1", toolCalls: [{ name: "builtin_session_current_model", args: {} }] };
        },
      }),
    );
    await start(a, host, { userTurn: "which model are you? grok maybe" });
    await start(b, host, { userTurn: "which model are you?" });
    expect(asked.calls).toEqual([{ model: "xai-oauth/grok-4.5" }, { model: "direct/minimax/MiniMax-M1" }]);
  });

  it("relays each chat's frames under its own id, so a panel can tell them apart", async () => {
    const a = freshChatId();
    const b = freshChatId();
    const host = createBrainRunHost(ports({ script: [{ text: "A." }, { text: "B." }] }));
    const s = sink();
    host.attach(s);
    await Promise.all([start(a, host), start(b, host)]);
    for (const id of [a, b]) {
      expect(s.frames.some((f) => f.type === "run.settled" && f.chatId === id)).toBe(true);
      expect(s.frames.some((f) => f.type === "run.tools" && f.chatId === id)).toBe(true);
    }
  });
});

describe("the confirm gate", () => {
  it("pauses a mutating call while Auto mode is off, and the panel's switch answers it live", async () => {
    const chatId = freshChatId();
    const edit = toolDef("edit_file", { mutating: true });
    const host = createBrainRunHost(
      ports({
        tools: [edit],
        script: [{ toolCalls: [{ name: "edit_file", args: { path: "a.ts" } }] }, { text: "Edited." }],
      }),
    );
    const s = sink();
    host.attach(s);
    const done = start(chatId, host, { autoApprove: false });
    // The loop parks on the confirm; the panel sees it in the relayed snapshot.
    await vi.waitFor(() => expect(getRunSnapshot(chatId).pendingConfirm?.name).toBe("edit_file"));
    expect(edit.calls).toHaveLength(0);
    // Flipping Auto mode ON approves the paused call and every later one.
    host.setAutoApprove(chatId, true);
    await done;
    expect(edit.calls).toHaveLength(1);
    expect(getRunSnapshot(chatId).appended.at(-1)?.content).toBe("Edited.");
  });

  /**
   * The reason the switch is per-chat. Runs live in the host precisely so several can
   * be in flight while the user reads, edits or talks in another tab — and while Auto
   * applied to all of them, "turn Auto on so THIS refactor stops asking me" also said
   * yes to whatever a different conversation was parked on: a delete, a push, a
   * base-branch commit, in a tab the user was not looking at.
   */
  it("keeps one chat's Auto switch out of another chat's paused call", async () => {
    const busy = freshChatId();
    const quiet = freshChatId();
    const edit = toolDef("edit_file", { mutating: true });
    const host = createBrainRunHost(
      ports({
        tools: [edit],
        script: [{ toolCalls: [{ name: "edit_file", args: { path: "a.ts" } }] }, { text: "Edited." }],
      }),
    );
    const done = start(busy, host, { autoApprove: false });
    await vi.waitFor(() => expect(getRunSnapshot(busy).pendingConfirm?.name).toBe("edit_file"));
    // The user flips Auto in a DIFFERENT chat's panel. The paused call must stay paused.
    host.setAutoApprove(quiet, true);
    await new Promise((r) => setTimeout(r, 20));
    expect(getRunSnapshot(busy).pendingConfirm?.name).toBe("edit_file");
    expect(edit.calls).toHaveLength(0);
    // Flipping it in the chat that IS asking answers it.
    host.setAutoApprove(busy, true);
    await done;
    expect(edit.calls).toHaveLength(1);
  });

  it("ignores a switch for a chat with no run in flight", () => {
    const host = createBrainRunHost(ports({ script: [{ text: "idle" }] }));
    expect(() => host.setAutoApprove(freshChatId(), true)).not.toThrow();
  });

  it("answers a paused call through confirm()", async () => {
    const chatId = freshChatId();
    const edit = toolDef("edit_file", { mutating: true });
    const host = createBrainRunHost(
      ports({ tools: [edit], script: [{ toolCalls: [{ name: "edit_file", args: { path: "a.ts" } }] }, { text: "Skipped." }] }),
    );
    const done = start(chatId, host, { autoApprove: false });
    await vi.waitFor(() => expect(getRunSnapshot(chatId).pendingConfirm).not.toBeNull());
    host.confirm(chatId, false);
    await done;
    expect(edit.calls).toHaveLength(0);
  });
});

describe("failure before the loop starts", () => {
  it("is reported as run.failed so the panel's awaited send rejects instead of hanging", async () => {
    const chatId = freshChatId();
    const host = createBrainRunHost(
      ports({ script: [{ text: "never" }], tools: undefined, stream: async () => { throw new Error("not_signed_in"); } }),
    );
    const s = sink();
    host.attach(s);
    await start(chatId, host);
    expect(s.frames.at(-1)).toEqual({ type: "run.failed", chatId, error: "not_signed_in" });
    expect(isRunning(chatId)).toBe(false);
  });
});
