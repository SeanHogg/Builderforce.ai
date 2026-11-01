/**
 * A memory flush whose tool calls a tenant governance gate refused: the run reports WHICH gates (the structured `policy.blocked` path,
 * on the run result), the flush logs a warning naming them, and it is STILL recorded as done so it is not re-run on every turn.
 */
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun } from "./queue.js";

const state = vi.hoisted(() => ({ runEmbeddedAgentMock: vi.fn(), warn: vi.fn() }));

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: async ({ provider, model, run }: { provider: string; model: string; run: (p: string, m: string) => Promise<unknown> }) => ({
    result: await run(provider, model),
    provider,
    model,
  }),
}));
vi.mock("../../agents/embedded.js", () => ({
  queueEmbeddedMessage: vi.fn().mockReturnValue(false),
  runEmbeddedAgent: (params: unknown) => state.runEmbeddedAgentMock(params),
}));
vi.mock("../../logger.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../logger.js")>()),
  logWarn: state.warn,
}));

import { runMemoryFlushIfNeeded } from "./agent-runner-memory.js";

let root = "";
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "builderforce-flush-gov-"));
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
});

const followupRun = {
  prompt: "hello",
  summaryLine: "hello",
  enqueuedAt: Date.now(),
  run: {
    agentId: "main",
    agentDir: "/tmp/agent",
    sessionId: "session",
    sessionKey: "main",
    messageProvider: "whatsapp",
    sessionFile: "/tmp/session.jsonl",
    workspaceDir: "/tmp",
    config: {},
    skillsSnapshot: {},
    provider: "anthropic",
    model: "claude",
    thinkLevel: "low",
    verboseLevel: "off",
    elevatedLevel: "off",
    bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
    timeoutMs: 1_000,
    blockReplyBreak: "message_end",
  },
} as unknown as FollowupRun;

async function flush(meta: Record<string, unknown>) {
  const storePath = path.join(root, `sessions-${Math.random().toString(36).slice(2)}.json`);
  const entry = { sessionId: "session", updatedAt: Date.now(), totalTokens: 80_000, compactionCount: 1 } as SessionEntry;
  await fs.writeFile(storePath, JSON.stringify({ main: entry }));
  state.runEmbeddedAgentMock.mockResolvedValue({ payloads: [], meta });
  await runMemoryFlushIfNeeded({
    cfg: {},
    followupRun,
    sessionCtx: { Provider: "whatsapp", MessageSid: "msg" } as unknown as TemplateContext,
    defaultModel: "anthropic/claude-opus-4-5",
    agentCfgContextTokens: 100_000,
    resolvedVerboseLevel: "off",
    sessionEntry: entry,
    sessionStore: { main: entry },
    sessionKey: "main",
    storePath,
    isHeartbeat: false,
  });
  return JSON.parse(await fs.readFile(storePath, "utf-8")).main as SessionEntry;
}

describe("a memory flush refused by a governance gate", () => {
  it("is run unattended (so an approval gate refuses at once)", async () => {
    await flush({});
    expect(state.runEmbeddedAgentMock).toHaveBeenCalledTimes(1);
    expect(state.runEmbeddedAgentMock.mock.calls[0]![0]).toMatchObject({ unattended: true });
  });

  it("logs a warning naming the gate, and is STILL recorded as done", async () => {
    const stored = await flush({ agentMeta: { governanceRefusals: ["no-write"] } });

    expect(state.warn).toHaveBeenCalledTimes(1);
    expect(String(state.warn.mock.calls[0]![0])).toContain("no-write");
    expect((stored as { memoryFlushAt?: number }).memoryFlushAt).toBeTypeOf("number");
    expect((stored as { memoryFlushCompactionCount?: number }).memoryFlushCompactionCount).toBe(1);
  });

  it("control: a flush no gate refused logs nothing and is recorded", async () => {
    const stored = await flush({ agentMeta: {} });

    expect(state.warn).not.toHaveBeenCalled();
    expect((stored as { memoryFlushAt?: number }).memoryFlushAt).toBeTypeOf("number");
  });
});
