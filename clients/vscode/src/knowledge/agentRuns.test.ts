import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainChat, BrainMessage } from "@seanhogg/builderforce-brain-embedded";

vi.mock("@seanhogg/builderforce-brain-embedded/runFindings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@seanhogg/builderforce-brain-embedded/runFindings")>();
  return { ...real, detectRunFindings: vi.fn(real.detectRunFindings) };
});

import { detectRunFindings } from "@seanhogg/builderforce-brain-embedded/runFindings";
import { createAgentRuns, MEMO_SIZE, type AgentRunsStore } from "./agentRuns";

const detect = vi.mocked(detectRunFindings);

const chat = (id: number, title: string, projectId: number | null = 1, updatedAt = "2026-11-09T10:00:00Z"): BrainChat =>
  ({ id, title, projectId, updatedAt } as BrainChat);
let seq = 0;
const msg = (role: string, content: string, metadata: string | null = null): BrainMessage =>
  ({ id: ++seq, role, content, metadata, seq, createdAt: `2026-11-09T10:00:${String(seq).padStart(2, "0")}Z` });
const step = (label: string, category = "tool") =>
  msg("tool", "", JSON.stringify({ kind: "step", category, label, args: { path: "src/a.ts" }, ts: `2026-11-09T10:00:${String(seq + 1).padStart(2, "0")}Z` }));

function fakeStore(chats: BrainChat[], messages: Map<number, BrainMessage[]>) {
  const store = {
    listChats: vi.fn(async (params?: { projectId?: string; limit?: number }) =>
      chats.filter((c) => params?.projectId === undefined || String(c.projectId) === params.projectId).slice(0, params?.limit)),
    getChat: vi.fn(async (id: number) => {
      const found = chats.find((c) => c.id === id);
      if (!found) throw new Error(`no chat ${id}`);
      return found;
    }),
    getMessages: vi.fn(async (chatId: number) => messages.get(chatId) ?? []),
  } satisfies AgentRunsStore;
  return store;
}

describe("createAgentRuns", () => {
  beforeEach(() => { detect.mockClear(); seq = 0; });

  it("lists only chats with step rows, of the linked project, through the memo", async () => {
    const messages = new Map<number, BrainMessage[]>([
      [1, [msg("user", "fix it"), step("read_file"), msg("assistant", "done")]],
      [2, [msg("user", "just chatting"), msg("assistant", "hi")]],
      [3, [msg("user", "other project"), step("read_file")]],
    ]);
    const store = fakeStore([chat(1, "Run one"), chat(2, "No tools"), chat(3, "Elsewhere", 2)], messages);
    const runs = createAgentRuns(store, () => 1);
    const list = await runs.list();
    expect(list.map((s) => [s.id, s.title])).toEqual([["1", "Run one"]]);
    expect(detect).toHaveBeenCalledTimes(1);

    const report = await runs.report("1");
    expect(report?.summary.id).toBe("1");
    expect(detect).toHaveBeenCalledTimes(1); // memo hit: the run has not moved
  });

  it("answers a memo hit without reading messages, for runs and non-runs alike", async () => {
    const messages = new Map<number, BrainMessage[]>([
      [1, [msg("user", "go"), step("read_file")]],
      [2, [msg("user", "hi")]],
    ]);
    const store = fakeStore([chat(1, "Run"), chat(2, "Chat")], messages);
    const runs = createAgentRuns(store, () => undefined);
    await runs.list();
    expect(store.getMessages).toHaveBeenCalledTimes(2);
    await runs.list();
    await runs.report("1");
    expect(store.getMessages).toHaveBeenCalledTimes(2);
  });

  it("recomputes a run once its updatedAt moves, and never for an unchanged one", async () => {
    const messages = new Map<number, BrainMessage[]>([[5, [msg("user", "go"), step("read_file")]]]);
    const chats = [chat(5, "Five")];
    const store = fakeStore(chats, messages);
    const runs = createAgentRuns(store, () => undefined);
    await runs.list();
    await runs.list();
    expect(detect).toHaveBeenCalledTimes(1);
    messages.get(5)!.push(step("write_file"));
    chats[0] = chat(5, "Five", 1, "2026-11-09T10:05:00Z");
    await runs.report("5");
    expect(detect).toHaveBeenCalledTimes(2);
    await runs.report("5");
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used chat past the memo bound", async () => {
    const count = MEMO_SIZE + 1;
    const chats = Array.from({ length: count }, (_, i) => chat(i + 1, `Chat ${i + 1}`));
    const messages = new Map<number, BrainMessage[]>(chats.map((c) => [c.id, [msg("user", "hi")]]));
    const store = fakeStore(chats, messages);
    const runs = createAgentRuns(store, () => undefined);
    for (const c of chats) await runs.report(String(c.id));
    expect(store.getMessages).toHaveBeenCalledTimes(count);
    await runs.report(String(count)); // most recent: still memoised
    expect(store.getMessages).toHaveBeenCalledTimes(count);
    await runs.report("1"); // first in, evicted
    expect(store.getMessages).toHaveBeenCalledTimes(count + 1);
  });

  it("scopes report to the linked project, by id, without scanning every chat", async () => {
    const messages = new Map<number, BrainMessage[]>([[3, [msg("user", "other project"), step("read_file")]]]);
    const store = fakeStore([chat(3, "Elsewhere", 2)], messages);
    expect(await createAgentRuns(store, () => 1).report("3")).toBeNull();
    expect(store.getMessages).not.toHaveBeenCalled();
    expect(store.listChats).not.toHaveBeenCalled();
    expect((await createAgentRuns(store, () => 2).report("3"))?.summary.id).toBe("3");
    expect(store.listChats).not.toHaveBeenCalled();
  });

  it("answers null for an unknown or non-run chat", async () => {
    const runs = createAgentRuns(fakeStore([chat(1, "No tools")], new Map([[1, [msg("user", "hi")]]])), () => undefined);
    expect(await runs.report("1")).toBeNull();
    expect(await runs.report("99")).toBeNull();
    expect(await runs.report("nope")).toBeNull();
  });
});
