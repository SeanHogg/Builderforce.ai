/**
 * PRD 35 E10: a `run.start` that arrives while the key's run is still live — a steer turn
 * re-submitted as the run that woke for it ends, a double submit — is the key's NEXT turn.
 * It used to return at once and the person's turn was silently lost. On the REAL shared loop
 * against a scripted gateway.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { isRunning, resetBrainRunStore, type BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { fakeGateway, type FakeGateway, type TurnContext } from "../harness/fakeGateway";
import type { ToolDef } from "./fileTools";
import { createBrainRunHost, type BrainRunHostPorts } from "./brainRunHost";
import { transientRunPersistence } from "./nativeBrainRun";

function readTool(): ToolDef {
  return {
    name: "read_file",
    description: "read",
    parameters: { type: "object", properties: {} },
    mutating: false,
    async execute() {
      return JSON.stringify({ ok: true, content: "hello" });
    },
  };
}

function ports(gateway: FakeGateway): BrainRunHostPorts {
  return {
    tools: async () => [readTool()],
    workspaceRoot: () => "/workspace",
    stream: async () => gateway.stream as unknown as BrainStreamFn,
    persistence: transientRunPersistence(),
    evermind: () => undefined,
    labels: { blockedByPolicy: (r) => `blocked: ${r}` },
  };
}

const textOf = (ctx: TurnContext): string =>
  ctx.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n");

let nextChatId = 9500;
const freshChatId = (): number => (nextChatId += 1);

beforeEach(() => {
  resetBrainRunStore();
});

describe("a turn submitted while the key's run is live (PRD 35 E10)", () => {
  it("is not dropped: it runs as the next turn once the live run has settled", async () => {
    const chatId = freshChatId();
    const seen: TurnContext[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const gateway = fakeGateway((ctx) => {
      seen.push(ctx);
      return { text: seen.length === 1 ? "First answer." : "Second answer." };
    });
    // The first turn's model call waits, so the key is live when the second start arrives.
    const slow: BrainStreamFn = async (opts, handlers) => {
      if (seen.length === 0) await held;
      return gateway.stream(opts, handlers);
    };
    const host = createBrainRunHost({ ...ports(gateway), stream: async () => slow });

    const first = host.start({ chatId, systemPrompt: "sys", userTurn: "first ask", autoApprove: true, evermind: false });
    while (!isRunning(chatId)) await new Promise((r) => setTimeout(r, 5));
    let secondSettled = false;
    const second = host.start({ chatId, systemPrompt: "sys", userTurn: "second ask", autoApprove: true, evermind: false }).then(() => { secondSettled = true; });

    // The second start is parked, not finished and not lost.
    await new Promise((r) => setTimeout(r, 30));
    expect(secondSettled).toBe(false);
    expect(seen).toHaveLength(0);

    release();
    await first;
    await second;

    expect(seen).toHaveLength(2);
    expect(textOf(seen[1]!)).toContain("second ask");
    expect(isRunning(chatId)).toBe(false);
  });

  it("is dropped with the run when the person pressed Stop — Stop ends the conversation's work", async () => {
    const chatId = freshChatId();
    const seen: TurnContext[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const gateway = fakeGateway((ctx) => {
      seen.push(ctx);
      return { text: "answer" };
    });
    const slow: BrainStreamFn = async (opts, handlers) => {
      if (seen.length === 0) await held;
      return gateway.stream(opts, handlers);
    };
    const host = createBrainRunHost({ ...ports(gateway), stream: async () => slow });

    const first = host.start({ chatId, systemPrompt: "sys", userTurn: "first ask", autoApprove: true, evermind: false });
    while (!isRunning(chatId)) await new Promise((r) => setTimeout(r, 5));
    const second = host.start({ chatId, systemPrompt: "sys", userTurn: "second ask", autoApprove: true, evermind: false });
    host.stop(chatId);
    release();
    await first;
    await second;

    expect(seen.every((ctx) => !textOf(ctx).includes("second ask"))).toBe(true);
    expect(isRunning(chatId)).toBe(false);
  });

  /** A host whose first model call waits on `release`, recording what each call was sent. */
  function slowHost() {
    const seen: TurnContext[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const gateway = fakeGateway((ctx) => {
      seen.push(ctx);
      return { text: `answer ${seen.length}` };
    });
    const slow: BrainStreamFn = async (opts, handlers) => {
      if (seen.length === 0) await held;
      return gateway.stream(opts, handlers);
    };
    return { seen, release, host: createBrainRunHost({ ...ports(gateway), stream: async () => slow }) };
  }
  const start = (host: ReturnType<typeof createBrainRunHost>, chatId: number, userTurn: string) =>
    host.start({ chatId, systemPrompt: "sys", userTurn, autoApprove: true, evermind: false });

  it("keeps the order of two or more parked turns", async () => {
    const chatId = freshChatId();
    const { seen, release, host } = slowHost();
    const first = start(host, chatId, "first ask");
    while (!isRunning(chatId)) await new Promise((r) => setTimeout(r, 5));
    const second = start(host, chatId, "second ask");
    const third = start(host, chatId, "third ask");

    release();
    await Promise.all([first, second, third]);

    expect(seen).toHaveLength(3);
    expect(textOf(seen[1]!)).toContain("second ask");
    expect(textOf(seen[2]!)).toContain("third ask");
  });

  it("a Stop drops the turns parked before it, but a turn typed after it is the person's new request and runs", async () => {
    const chatId = freshChatId();
    const { seen, release, host } = slowHost();
    const first = start(host, chatId, "first ask");
    while (!isRunning(chatId)) await new Promise((r) => setTimeout(r, 5));
    const parkedBefore = start(host, chatId, "parked before the stop");
    host.stop(chatId);
    const typedAfter = start(host, chatId, "typed after the stop");

    release();
    await Promise.all([first, parkedBefore, typedAfter]);

    const sent = seen.map(textOf).join("
");
    expect(sent).not.toContain("parked before the stop");
    expect(seen.some((ctx) => textOf(ctx).includes("typed after the stop"))).toBe(true);
    expect(isRunning(chatId)).toBe(false);
  });
});
