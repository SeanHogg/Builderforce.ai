/**
 * PRD 35 E10: a message typed at a run is NEVER dropped, whichever window it lands in.
 * On the REAL shared loop against a scripted gateway:
 *   - the run already ended (idle): the message is its next turn;
 *   - the run is unwinding (its loop ended, the host is still closing it): what waits is
 *     sent on, together and in order, as ONE new turn once it has settled;
 *   - a run that was STOPPED drops what waited — Stop ends the work, waiting words too;
 *   - every settle (finish or Stop) releases the run's held resources (`settleRun`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
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

function ports(gateway: FakeGateway, extra: Partial<BrainRunHostPorts> = {}): BrainRunHostPorts {
  return {
    tools: async () => [readTool()],
    workspaceRoot: () => "/workspace",
    stream: async () => gateway.stream as unknown as BrainStreamFn,
    persistence: transientRunPersistence(),
    evermind: () => undefined,
    labels: { blockedByPolicy: (r) => `blocked: ${r}` },
    ...extra,
  };
}

const textOf = (ctx: TurnContext): string =>
  ctx.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n");

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

let nextChatId = 9300;
const freshChatId = (): number => (nextChatId += 1);

beforeEach(() => {
  resetBrainRunStore();
});

describe("a steer that misses the running run is not lost (PRD 35 E10)", () => {
  it("idle: a message steered at a run that already ended is its next turn", async () => {
    const chatId = freshChatId();
    const seen: TurnContext[] = [];
    const gateway = fakeGateway((ctx) => {
      seen.push(ctx);
      return { text: seen.length === 1 ? "First answer." : "Second answer." };
    });
    const host = createBrainRunHost(ports(gateway));
    await host.start({ chatId, systemPrompt: "sys", userTurn: "first ask", autoApprove: true, evermind: false });
    expect(isRunning(chatId)).toBe(false);

    host.steer(chatId, "and also check the README");
    await until(() => seen.length >= 2 && !isRunning(chatId));
    expect(seen).toHaveLength(2);
    expect(textOf(seen[1]!)).toContain("and also check the README");
  });

  it("unwinding: messages that arrive as the run ends are sent on as ONE new turn, in order", async () => {
    const chatId = freshChatId();
    const seen: TurnContext[] = [];
    const gateway = fakeGateway((ctx) => {
      seen.push(ctx);
      if (seen.length === 1) return { toolCalls: [{ name: "read_file", args: { path: "a.ts" } }] };
      return { text: "Done." };
    });
    let host!: ReturnType<typeof createBrainRunHost>;
    let typed = false;
    host = createBrainRunHost(ports(gateway, {
      // The run's note is written while the host is still closing the run — its loop has
      // ended, the key is still claimed. The person types twice right then.
      sessionNote: () => {
        if (typed) return;
        typed = true;
        host.steer(chatId, "late one");
        host.steer(chatId, "late two");
      },
    }));
    await host.start({ chatId, systemPrompt: "sys", userTurn: "read a.ts", autoApprove: true, evermind: false });
    await until(() => seen.length >= 3 && !isRunning(chatId));
    expect(typed).toBe(true);
    expect(seen).toHaveLength(3);
    const last = seen[2]!.messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : ""));
    expect(last.some((t) => /late one[\s\S]*late two/.test(t))).toBe(true);
  });

  it("a STOPPED run drops what waited for it, and every settle releases the run", async () => {
    const chatId = freshChatId();
    const seen: TurnContext[] = [];
    const settleRun = vi.fn();
    let host!: ReturnType<typeof createBrainRunHost>;
    const gateway = fakeGateway((ctx) => {
      seen.push(ctx);
      // The person types, then presses Stop, while the first turn is being answered.
      host.steer(chatId, "also do Y");
      host.stop(chatId);
      return { text: "partial" };
    });
    host = createBrainRunHost(ports(gateway, { settleRun }));
    await host.start({ chatId, systemPrompt: "sys", userTurn: "do X", autoApprove: true, evermind: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveLength(1);
    expect(isRunning(chatId)).toBe(false);
    expect(settleRun).toHaveBeenCalledWith(chatId);
  });

  it("a stop command with nothing running starts nothing", async () => {
    const chatId = freshChatId();
    const gateway = fakeGateway([{ text: "ok" }]);
    const host = createBrainRunHost(ports(gateway));
    await host.start({ chatId, systemPrompt: "sys", userTurn: "hi", autoApprove: true, evermind: false });
    host.steer(chatId, "stop");
    await new Promise((r) => setTimeout(r, 50));
    expect(gateway.requests).toHaveLength(1);
  });
});
