/**
 * The native `@builderforce` participant's turn, through `runViaHost`: the REAL run host (`createBrainRunHost`) and the real
 * shared loop against a scripted gateway (`harness/fakeGateway`). What these prove is what the participant owns around the
 * ONE host start - the chat view's lines (text, the running tool, the finished tool, the fallback notice, a failure), the
 * approval question, the busy refusal, the dispatch hint and Stop - and that the host's own setup (default checkout, context
 * pack, PreFetch, settle release) reaches a participant turn. Not reachable here: a real `ChatResponseStream` and modal.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TOOL_FAILURE_STREAK,
  getRunSnapshot,
  isRunning,
  resetBrainRunStore,
  startRun,
  type BrainStreamFn,
} from "@seanhogg/builderforce-brain-embedded";
import { answerFunctionPort } from "@builderforce/prefetch/testing";
import { fakeGateway, type GatewayScript } from "../harness/fakeGateway";
import type { ToolDef, ToolRunOptions } from "./fileTools";
import { createBrainRunHost, type BrainRunHostPorts } from "./brainRunHost";
import { transientRunPersistence } from "./nativeRunStream";
import type { NativeApprovalRequest } from "./nativeRunTypes";
import { runViaHost, type ParticipantHost } from "./participantRun";

const HINT = "[dispatch hint]";

function toolDef(
  name: string,
  opts: { mutating?: boolean; result?: unknown; throws?: string; onRun?: (run: ToolRunOptions | undefined) => void } = {},
): ToolDef & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: "object", properties: {} },
    mutating: opts.mutating ?? false,
    calls,
    async execute(args, _root, run) {
      calls.push(args);
      opts.onRun?.(run);
      if (opts.throws) throw new Error(opts.throws);
      return JSON.stringify(opts.result ?? { ok: true });
    },
  };
}

let nextChatId = 8000;
const freshChatId = (): number => (nextChatId += 1);

interface Turn {
  script: GatewayScript;
  tools?: ToolDef[];
  autoApprove?: boolean;
  approve?: (req: NativeApprovalRequest) => Promise<boolean>;
  ports?: Partial<Omit<BrainRunHostPorts, "tools" | "stream">>;
  host?: (host: ParticipantHost) => ParticipantHost;
  signal?: AbortSignal;
  chatId?: number;
  alreadyRunning?: string;
  onModelFallback?: (from: string, reason?: string) => void;
}

/** One participant turn against a scripted gateway, recording what the chat view would have rendered. */
async function runTurn(t: Turn) {
  const gateway = fakeGateway(t.script);
  const sent: unknown[] = [];
  const stream: BrainStreamFn = ((opts: { messages: unknown }, handlers: never) => {
    sent.push(opts.messages);
    return (gateway.stream as unknown as BrainStreamFn)(opts as never, handlers);
  }) as BrainStreamFn;
  const host = createBrainRunHost({
    tools: async () => t.tools ?? [],
    workspaceRoot: () => "/workspace",
    stream: async () => stream,
    persistence: transientRunPersistence(),
    evermind: () => undefined,
    labels: { blockedByPolicy: (r: string) => `Blocked by a governance gate: ${r}`, dispatchHint: HINT },
    ...t.ports,
  } as never);
  const log = { text: "", toolStarts: [] as string[], toolResults: [] as Array<{ label: string; ok: boolean }>, errors: [] as string[] };
  const approvals: NativeApprovalRequest[] = [];
  const chatId = t.chatId ?? freshChatId();
  const ran = await runViaHost({
    host: t.host ? t.host(host) : host,
    spec: {
      chatId,
      systemPrompt: "You are the BuilderForce IDE agent.",
      userTurn: "what does this project do?",
      autoApprove: t.autoApprove ?? true,
      evermind: false,
      wakeable: false,
    },
    approve: async (req) => {
      approvals.push(req);
      return t.approve ? t.approve(req) : true;
    },
    events: {
      onText: (d) => { log.text += d; },
      onToolStart: (l) => log.toolStarts.push(l),
      onToolResult: (label, ok) => log.toolResults.push({ label, ok }),
      onError: (m) => log.errors.push(m),
    },
    labels: { dispatchHint: HINT, ...(t.alreadyRunning ? { alreadyRunning: t.alreadyRunning } : {}) },
    onModelFallback: t.onModelFallback ?? (() => undefined),
    signal: t.signal ?? new AbortController().signal,
  });
  return { ran, log, approvals, requests: gateway.requests, sent, chatId };
}

beforeEach(() => {
  resetBrainRunStore();
});

describe("a plain Q&A turn", () => {
  it("streams the answer once - no duplicate final block when the loop commits it", async () => {
    const { log, requests, ran } = await runTurn({ script: [{ text: "It is a monorepo." }] });
    expect(ran).toBe(true);
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

describe("the tool lines", () => {
  it("regression: a tool shows as RUNNING (from the run store's live step) before its finished line", async () => {
    const read = toolDef("read_file", { result: { content: "hi" } });
    const { log } = await runTurn({
      tools: [read],
      script: (ctx) => (ctx.turn === 0 ? { toolCalls: [{ name: "read_file", args: { path: "src/a.ts" } }] } : { text: "ok" }),
    });
    expect(log.toolStarts).toHaveLength(1);
    expect(log.toolStarts[0]).toContain("read_file");
    expect(log.toolStarts[0]).toContain("src/a.ts");
    expect(log.toolResults).toContainEqual({ label: "read src/a.ts", ok: true });
  });
});

describe("a workspace edit", () => {
  it("pauses for approval and runs the tool when the human approves", async () => {
    const write = toolDef("write_file", { mutating: true });
    const { log, approvals } = await runTurn({
      tools: [write],
      autoApprove: false,
      approve: async () => true,
      script: (ctx) => (ctx.turn === 0 ? { toolCalls: [{ name: "write_file", args: { path: "src/app.ts" } }] } : { text: "Done." }),
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
      autoApprove: false,
      approve: async () => false,
      script: (ctx) => {
        for (const m of ctx.messages) if (m.role === "tool") toolResults.push(String(m.content));
        return ctx.turn === 0 ? { toolCalls: [{ name: "write_file", args: { path: "src/app.ts" } }] } : { text: "Understood." };
      },
    });
    expect(write.calls).toHaveLength(0);
    expect(toolResults.join("\n")).toContain("User declined this action.");
  });

  it("does not pause for a read-only tool", async () => {
    const read = toolDef("read_file");
    const { approvals } = await runTurn({
      tools: [read],
      autoApprove: false,
      script: (ctx) => (ctx.turn === 0 ? { toolCalls: [{ name: "read_file", args: { path: "a.ts" } }] } : { text: "ok" }),
    });
    expect(approvals).toEqual([]);
    expect(read.calls).toHaveLength(1);
  });
});

describe("a governance gate", () => {
  it("blocks the call before it reaches the implementation, shows it as a failed line, and the run continues to an answer", async () => {
    const run = toolDef("run_command", { mutating: true });
    const { log, requests } = await runTurn({
      tools: [run],
      ports: { policyGates: async () => [{ id: "no-shell", tool: "run_command", effect: "block", reason: "shell is off-limits" }] },
      script: (ctx) => (ctx.turn === 0 ? { toolCalls: [{ name: "run_command", args: { command: "ls /" } }] } : { text: "I cannot." }),
    });
    expect(run.calls).toHaveLength(0);
    expect(log.toolResults.some((r) => !r.ok)).toBe(true);
    expect(requests).toHaveLength(2);
    expect(log.text).toContain("I cannot.");
  });
});

describe("a run whose tool calls keep failing", () => {
  it("is stopped by the consecutive-failure breaker and appends the dispatch hint", async () => {
    const read = toolDef("read_file", { throws: "EACCES: permission denied" });
    const { log, requests } = await runTurn({
      tools: [read],
      script: (ctx) =>
        ctx.toolless
          ? { text: "Here is what I found so far." }
          : { toolCalls: [{ name: "read_file", args: { path: `f${ctx.turn}.ts` } }] },
    });
    expect(requests).toHaveLength(DEFAULT_TOOL_FAILURE_STREAK + 1);
    expect(requests[DEFAULT_TOOL_FAILURE_STREAK]?.toolless).toBe(true);
    expect(log.text).toContain("Here is what I found so far.");
    expect(log.text).toContain(HINT);
  });

  it("does not append the hint to a run that finished normally", async () => {
    const { log } = await runTurn({ script: [{ text: "Done." }] });
    expect(log.text).not.toContain(HINT);
  });
});

describe("a failed run", () => {
  it("renders the failure once and clears it, so the NEXT turn does not re-report it", async () => {
    const chatId = freshChatId();
    const { log, ran } = await runTurn({
      chatId,
      script: [{ text: "" }],
      ports: { stream: async () => { throw new Error("not_signed_in"); } } as never,
    });
    expect(ran).toBe(true);
    expect(log.errors).toHaveLength(1);
    expect(getRunSnapshot(chatId).error).toBeFalsy();
  });
});

describe("the host's announcements for this chat", () => {
  /** A host that only records what the participant subscribed to, so the frames can be posted by hand. */
  function frameHost(frames: (post: (message: never) => void, chatId: number) => void): ParticipantHost {
    let sink: { post(message: never): void } | undefined;
    return {
      start: async (spec) => { frames((m) => sink?.post(m), spec.chatId); },
      stop: () => undefined,
      isBusy: () => false,
      attach: (s: never) => { sink = s; return () => { sink = undefined; }; },
      registerApprover: () => undefined,
      clearError: () => undefined,
    } as unknown as ParticipantHost;
  }

  it("renders Hybrid's fallback notice (the pick and why) and a finished tool, and ignores another chat's frames", async () => {
    const fallbacks: Array<[string, string | undefined]> = [];
    const { log } = await runTurn({
      script: [{ text: "" }],
      onModelFallback: (from, reason) => fallbacks.push([from, reason]),
      host: () => frameHost((post, chatId) => {
        post({ type: "run.modelFallback", chatId, from: "gpt-x", reason: "rate limited" } as never);
        post({ type: "run.tool", chatId, name: "edit_file", mutating: true, remote: false, ok: false, label: "edit a.ts" } as never);
        post({ type: "run.modelFallback", chatId: chatId + 1, from: "other", reason: "x" } as never);
        post({ type: "run.failed", chatId, error: "could not start" } as never);
      }),
    });
    expect(fallbacks).toEqual([["gpt-x", "rate limited"]]);
    expect(log.toolResults).toEqual([{ label: "edit a.ts", ok: false }]);
    expect(log.errors).toEqual(["could not start"]);
  });
});

describe("a chat whose run is already claimed", () => {
  it("does nothing - and says so - when another path already holds the chat's run in the store", async () => {
    const chatId = freshChatId();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const other = fakeGateway([{ text: "the other run" }]);
    const first = startRun(chatId, {
      resolvedSystemPrompt: "sys",
      stream: async (opts, handlers) => {
        await held;
        return other.stream(opts, handlers);
      },
      persistence: transientRunPersistence(),
      userTurn: "first",
    });
    while (!isRunning(chatId)) await new Promise((r) => setTimeout(r, 5));

    const { ran, requests, log } = await runTurn({ chatId, script: [{ text: "never asked" }], alreadyRunning: "Still working on your last request." });
    expect(ran).toBe(false);
    expect(requests).toHaveLength(0);
    expect(log.errors).toEqual(["Still working on your last request."]);
    release();
    await first;
  });

  it("also counts the run host's setup window: a key the host claimed but has not started is busy", async () => {
    const { ran, requests, log } = await runTurn({
      script: [{ text: "never asked" }],
      alreadyRunning: "busy",
      host: (host) => ({ ...host, isBusy: () => true }),
    });
    expect(ran).toBe(false);
    expect(requests).toHaveLength(0);
    expect(log.errors).toEqual(["busy"]);
  });
});

describe("Stop", () => {
  it("starts nothing for a request cancelled before the claim", async () => {
    const abort = new AbortController();
    abort.abort();
    const { ran, requests } = await runTurn({ script: [{ text: "never" }], signal: abort.signal });
    expect(ran).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("a cancel during the run is the host's Stop for that chat, and the turn reports it ran", async () => {
    const abort = new AbortController();
    const stop = vi.fn();
    const chatId = freshChatId();
    const { ran } = await runTurn({
      chatId,
      script: [{ text: "" }],
      signal: abort.signal,
      host: (host) => ({
        ...host,
        stop: (id: number) => { stop(id); host.stop(id); },
        start: async (spec) => { abort.abort(); await host.start(spec); },
      }),
    });
    expect(ran).toBe(true);
    expect(stop).toHaveBeenCalledWith(chatId);
  });
});

describe("the host's setup reaches a participant turn (PRD 35 E2 / E3 / E7, WS-L)", () => {
  it("hands the model the context pack as the turn's context", async () => {
    const { sent } = await runTurn({
      script: [{ text: "Done." }],
      ports: { contextPack: async () => ({ block: "### Focus file `README.md` (3 lines, whole file)", recallHint: "" }) },
    });
    expect(JSON.stringify(sent[0])).toContain("Focus file `README.md`");
  });

  it("runs the tools in the run's default checkout, waiting for it to resolve, under the turn's run key", async () => {
    const seen: Array<ToolRunOptions | undefined> = [];
    let resolveRepo!: (repo: string) => void;
    const repo = new Promise<string>((resolve) => { resolveRepo = resolve; });
    const run = runTurn({
      tools: [toolDef("run_command", { onRun: (r) => seen.push(r) })],
      ports: { defaultRepo: () => repo },
      script: [{ toolCalls: [{ name: "run_command", args: { command: "pnpm test" } }] }, { text: "Done." }],
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(0);
    resolveRepo("/workspace/api");
    const { chatId } = await run;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ defaultRepo: "/workspace/api", runKey: chatId });
  });

  it("releases what the turn held when it settles", async () => {
    const settleRun = vi.fn();
    const { chatId } = await runTurn({ script: [{ text: "Done." }], ports: { settleRun } });
    expect(settleRun).toHaveBeenCalledTimes(1);
    expect(settleRun).toHaveBeenCalledWith(chatId);
  });

  it("adopts the symbol-index answer with no model call", async () => {
    const asked: string[] = [];
    const { requests, log } = await runTurn({
      script: [{ text: "From the model." }],
      ports: { prefetch: answerFunctionPort(async (q) => { asked.push(q); return "`Widget` is defined in src/widget.ts:12"; }) },
    });
    expect(asked).toHaveLength(1);
    expect(requests).toHaveLength(0);
    expect(log.text).toContain("src/widget.ts:12");
  });

  it("asks the model when the index cannot answer", async () => {
    const { requests, log } = await runTurn({
      script: [{ text: "From the model." }],
      ports: { prefetch: answerFunctionPort(async () => undefined) },
    });
    expect(requests).toHaveLength(1);
    expect(log.text).toContain("From the model.");
  });
});
