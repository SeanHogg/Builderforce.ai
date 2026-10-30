/**
 * The native participant gets the panel run host's SETUP (PRD 35 E2 / E3 / E7): the task
 * context pack as the run's turn context, the run's default checkout for its tools, and a
 * run key — so the background jobs the turn starts die with it. On the REAL shared loop
 * against a scripted gateway.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRunning, resetBrainRunStore, startRun } from "@seanhogg/builderforce-brain-embedded";
import { fakeGateway } from "../harness/fakeGateway";
import type { ToolDef, ToolRunOptions } from "./fileTools";
import { runNativeBrain, transientRunPersistence, type NativeBrainRunOptions } from "./nativeBrainRun";

const LABELS = { dispatchHint: "[dispatch hint]", blockedByPolicy: (reason: string) => reason };

let nextChatId = 6000;

function shellTool(seen: Array<ToolRunOptions | undefined>): ToolDef {
  return {
    name: "run_command",
    description: "Run a shell command.",
    parameters: { type: "object", properties: { command: { type: "string" } } },
    mutating: false,
    async execute(_args, _root, run) {
      seen.push(run);
      return JSON.stringify({ ok: true, exitCode: 0, stdout: "" });
    },
  };
}

async function turn(extra: Partial<NativeBrainRunOptions>, script = [{ text: "Done." }] as Parameters<typeof fakeGateway>[0]) {
  const gateway = fakeGateway(script);
  const sent: unknown[] = [];
  const chatId = ++nextChatId;
  await runNativeBrain({
    chatId,
    systemPrompt: "You are the BuilderForce IDE agent.",
    seed: [],
    userTurn: "run the tests",
    tools: [],
    root: "/workspace",
    permissionMode: "acceptEdits",
    approve: async () => true,
    stream: (opts, handlers) => {
      sent.push(opts.messages);
      return gateway.stream(opts, handlers);
    },
    persistence: transientRunPersistence(),
    signal: new AbortController().signal,
    labels: LABELS,
    events: { onText: () => undefined, onToolStart: () => undefined, onToolResult: () => undefined, onError: () => undefined },
    ...extra,
  });
  return { chatId, sent };
}

beforeEach(() => {
  resetBrainRunStore();
});

describe("the native participant's run setup", () => {
  it("hands the model the context pack as the turn's context and says the preflight before turn 1", async () => {
    const { sent } = await turn({
      runContext: {
        turnContext: async () => "### Focus file `README.md` (3 lines, whole file)",
        modelPreflight: async () => ({ byoUnresolved: ["anthropic:expired"] }),
      },
    });
    expect(JSON.stringify(sent[0])).toContain("Focus file `README.md`");
  });

  it("runs the tools in the run's default checkout, waiting for it to resolve, under the turn's run key", async () => {
    const seen: Array<ToolRunOptions | undefined> = [];
    let resolveRepo!: () => void;
    const repoReady = new Promise<void>((resolve) => { resolveRepo = resolve; });
    let repo: string | undefined;
    const run = turn(
      { tools: [shellTool(seen)], defaultRepo: () => repo, repoReady },
      [{ toolCalls: [{ name: "run_command", args: { command: "pnpm test" } }] }, { text: "Done." }],
    );
    // The call waits for the checkout: nothing ran before it resolved.
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(0);
    repo = "/workspace/api";
    resolveRepo();
    const { chatId } = await run;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ defaultRepo: "/workspace/api", runKey: chatId });
  });

  it("releases what the turn held when it settles", async () => {
    const settleRun = vi.fn();
    const { chatId } = await turn({ settleRun });
    expect(settleRun).toHaveBeenCalledTimes(1);
    expect(settleRun).toHaveBeenCalledWith(chatId);
  });

  it("does nothing - and settles nothing - when another path already holds the chat's run", async () => {
    const chatId = ++nextChatId;
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

    const mine = fakeGateway([{ text: "never asked" }]);
    const settleRun = vi.fn();
    const errors: string[] = [];
    const ran = await runNativeBrain({
      chatId,
      systemPrompt: "sys",
      seed: [],
      userTurn: "second",
      tools: [],
      root: "/workspace",
      permissionMode: "ask",
      approve: async () => true,
      stream: mine.stream,
      persistence: transientRunPersistence(),
      signal: new AbortController().signal,
      labels: { ...LABELS, alreadyRunning: "Still working on your last request." },
      events: { onText: () => undefined, onToolStart: () => undefined, onToolResult: () => undefined, onError: (message) => { errors.push(message); } },
      settleRun,
    });

    expect(ran).toBe(false);
    expect(mine.requests).toHaveLength(0);
    expect(settleRun).not.toHaveBeenCalled();
    expect(errors).toEqual(["Still working on your last request."]);
    release();
    await first;
  });

  it("also counts the run host's setup window: a key the host claimed but has not started is busy", async () => {
    const mine = fakeGateway([{ text: "never asked" }]);
    const settleRun = vi.fn();
    const errors: string[] = [];
    const ran = await runNativeBrain({
      chatId: ++nextChatId,
      systemPrompt: "sys",
      seed: [],
      userTurn: "second",
      tools: [],
      root: "/workspace",
      permissionMode: "ask",
      approve: async () => true,
      stream: mine.stream,
      persistence: transientRunPersistence(),
      signal: new AbortController().signal,
      labels: { ...LABELS, alreadyRunning: "busy" },
      events: { onText: () => undefined, onToolStart: () => undefined, onToolResult: () => undefined, onError: (message) => { errors.push(message); } },
      settleRun,
      isBusy: () => true,
    });

    expect(ran).toBe(false);
    expect(mine.requests).toHaveLength(0);
    expect(settleRun).not.toHaveBeenCalled();
    expect(errors).toEqual(["busy"]);
  });
});
