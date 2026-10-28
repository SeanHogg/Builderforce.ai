/**
 * PRD 35 E10 on the editor's host-owned run, end to end on the REAL shared loop against a
 * scripted gateway: Stop — the button, or the words typed mid-run — kills the command in
 * flight and the model gets no further turn; any other message typed mid-run STEERS the
 * run: it interrupts the foreground command, skips the rest of that turn, and is in front
 * of the very next model call (recorded as `steer.applied`).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getRunTrace, isRunning, resetBrainRunStore, type BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { fakeGateway, type FakeGateway, type TurnContext } from "../harness/fakeGateway";
import type { ToolDef, ToolRunOptions } from "./fileTools";
import { createBrainRunHost, type BrainRunHostPorts } from "./brainRunHost";
import { transientRunPersistence } from "./nativeBrainRun";

/** A `run_command` that runs until its signal aborts — the 10-minute command. A safety
 *  bound (5s) keeps a broken signal path a failing assertion rather than a hung suite. */
function longCommand() {
  const state = { started: 0, aborted: 0 };
  let markStarted!: () => void;
  const started = new Promise<void>((r) => { markStarted = r; });
  const def: ToolDef = {
    name: "run_command",
    description: "Run a shell command.",
    parameters: { type: "object", properties: { command: { type: "string" } } },
    mutating: true,
    execute: (_args, _root, run?: ToolRunOptions) =>
      new Promise<string>((resolve) => {
        state.started += 1;
        markStarted();
        const timer = setTimeout(() => resolve(JSON.stringify({ ok: true, exitCode: 0, stdout: "finished on its own" })), 5_000);
        const onAbort = (): void => {
          clearTimeout(timer);
          state.aborted += 1;
          resolve(JSON.stringify({ ok: false, aborted: true, error: "stopped" }));
        };
        if (run?.signal?.aborted) return onAbort();
        run?.signal?.addEventListener("abort", onAbort, { once: true });
      }),
  };
  return { def, state, started };
}

function recordingTool(name: string): ToolDef & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: "object", properties: {} },
    mutating: false,
    calls,
    async execute(args) {
      calls.push(args);
      return JSON.stringify({ ok: true, content: "hello" });
    },
  };
}

function ports(gateway: FakeGateway, tools: ToolDef[]): BrainRunHostPorts {
  return {
    tools: async () => tools,
    workspaceRoot: () => "/workspace",
    stream: async () => gateway.stream as unknown as BrainStreamFn,
    persistence: transientRunPersistence(),
    evermind: () => undefined,
    labels: { blockedByPolicy: (r) => `blocked: ${r}` },
  };
}

let nextChatId = 9100;
const freshChatId = (): number => (nextChatId += 1);

const textOf = (ctx: TurnContext): string =>
  ctx.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n");

beforeEach(() => {
  resetBrainRunStore();
});

describe("Stop and steer reach the command in flight (PRD 35 E10)", () => {
  it("a typed 'STOP executing' stops the run like the button: the command is killed and the model gets no further turn", async () => {
    const chatId = freshChatId();
    const cmd = longCommand();
    const gateway = fakeGateway([{ toolCalls: [{ name: "run_command", args: { command: "npm test" } }] }, { text: "never asked" }]);
    const host = createBrainRunHost(ports(gateway, [cmd.def]));
    const t0 = Date.now();
    const run = host.start({ chatId, systemPrompt: "sys", userTurn: "run the tests", autoApprove: true, evermind: false });
    await cmd.started;
    host.steer(chatId, "STOP executing");
    await run;
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(cmd.state.aborted).toBe(1);
    expect(gateway.requests).toHaveLength(1);
    expect(isRunning(chatId)).toBe(false);
  });

  it("the Stop button settles the run within 2s while the command is still running", async () => {
    const chatId = freshChatId();
    const cmd = longCommand();
    const gateway = fakeGateway([{ toolCalls: [{ name: "run_command", args: { command: "npm test" } }] }, { text: "never asked" }]);
    const host = createBrainRunHost(ports(gateway, [cmd.def]));
    const t0 = Date.now();
    const run = host.start({ chatId, systemPrompt: "sys", userTurn: "run the tests", autoApprove: true, evermind: false });
    await cmd.started;
    host.stop(chatId);
    await run;
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(cmd.state.aborted).toBe(1);
    expect(gateway.requests).toHaveLength(1);
  });

  it("'write the update now' typed mid-run interrupts the command, skips the rest of the turn and reaches the next model call", async () => {
    const chatId = freshChatId();
    const cmd = longCommand();
    const read = recordingTool("read_file");
    const seen: TurnContext[] = [];
    const gateway = fakeGateway((ctx) => {
      seen.push(ctx);
      return ctx.turn === 0
        ? { toolCalls: [{ name: "run_command", args: { command: "npm test" } }, { name: "read_file", args: { path: "a.ts" } }] }
        : { text: "Done." };
    });
    const host = createBrainRunHost(ports(gateway, [cmd.def, read]));
    const run = host.start({ chatId, systemPrompt: "sys", userTurn: "run the tests, then update the PRD", autoApprove: true, evermind: false });
    await cmd.started;
    host.steer(chatId, "write the update now");
    await run;

    expect(cmd.state.aborted).toBe(1);
    // The turn's remaining call never ran.
    expect(read.calls).toHaveLength(0);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    const next = textOf(seen[1]!);
    expect(next).toContain("write the update now");
    // The interrupted command says so on the row the model reads.
    expect(next).toContain("Interrupted by the user's new message");
    expect(getRunTrace(chatId).some((e) => e.label === "steer.applied")).toBe(true);
  });
});

describe("a Stop while the run is still setting up", () => {
  it("never starts its loop, records the stop, and answers the turn so a reopened chat does not start it", async () => {
    const chatId = freshChatId();
    const gateway = fakeGateway([{ text: "never asked" }]);
    let releaseTools!: () => void;
    const toolsReady = new Promise<void>((r) => { releaseTools = r; });
    const base = ports(gateway, []);
    const saved: Array<{ role: string; content: string; metadata?: string }> = [];
    const persistence = {
      ...base.persistence,
      sendMessages: async (id: number, msgs: Array<{ role: string; content: string; metadata?: string }>) => {
        saved.push(...msgs);
        return base.persistence.sendMessages(id, msgs as never);
      },
    };
    const host = createBrainRunHost({ ...base, persistence: persistence as never, tools: async () => { await toolsReady; return []; } });
    const run = host.start({ chatId, systemPrompt: "sys", userTurn: "do the work", autoApprove: true, evermind: false });
    host.stop(chatId);
    releaseTools();
    await run;
    expect(gateway.requests).toHaveLength(0);
    expect(getRunTrace(chatId).some((e) => e.label === "agent.stopped")).toBe(true);
    expect(saved.some((m) => m.role === "assistant" && (m.metadata ?? "").includes("stoppedByUser"))).toBe(true);
  });
});
