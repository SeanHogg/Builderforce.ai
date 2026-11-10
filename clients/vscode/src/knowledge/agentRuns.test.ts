import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainChat, BrainMessage } from "@seanhogg/builderforce-brain-embedded";

vi.mock("@seanhogg/builderforce-brain-embedded/runFindings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@seanhogg/builderforce-brain-embedded/runFindings")>();
  return { ...real, detectRunFindings: vi.fn(real.detectRunFindings) };
});

import { detectRunFindings } from "@seanhogg/builderforce-brain-embedded/runFindings";
import {
  AGENT_RUNS_SHOWN,
  AgentRunsTimeoutError,
  CHATS_SCANNED,
  createAgentRuns,
  MEMO_SIZE,
  READ_WINDOW,
  type AgentRunsStore,
} from "./agentRuns";

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

/** The store's batch read, over the same messages (an unknown chat maps to []). */
function withBatch<S extends ReturnType<typeof fakeStore>>(store: S, messages: Map<number, BrainMessage[]>) {
  return Object.assign(store, {
    getMessagesForChats: vi.fn(async (chatIds: readonly number[]) => new Map(chatIds.map((id) => [id, messages.get(id) ?? []]))),
  });
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

  it("answers an empty list (never undefined) when nothing ran or no chat is recorded", async () => {
    expect(await createAgentRuns(fakeStore([], new Map()), () => 1).list()).toEqual([]);
    expect(await createAgentRuns(fakeStore([chat(1, "No tools")], new Map([[1, [msg("user", "hi")]]])), () => undefined).list()).toEqual([]);
  });

  it("looks through the most recent CHATS_SCANNED chats only", async () => {
    const chats = Array.from({ length: CHATS_SCANNED + 10 }, (_, i) => chat(i + 1, `Chat ${i + 1}`));
    const store = fakeStore(chats, new Map(chats.map((c) => [c.id, [msg("user", "hi")]])));
    await createAgentRuns(store, () => undefined).list();
    expect(store.listChats).toHaveBeenCalledWith({ limit: CHATS_SCANNED });
    expect(store.getMessages).toHaveBeenCalledTimes(CHATS_SCANNED);
  });

  // regression: the drawer sat on "Reading the recorded agent runs…" — one full store read per chat (11 s on a real store).
  it("reads the chats the memo cannot answer in ONE batch read, never chat by chat", async () => {
    const chats = [chat(1, "One"), chat(2, "Two"), chat(3, "Three")];
    const messages = new Map<number, BrainMessage[]>(chats.map((c) => [c.id, [msg("user", "go"), step("read_file")]]));
    const store = withBatch(fakeStore(chats, messages), messages);
    const runs = createAgentRuns(store, () => undefined);
    expect((await runs.list()).map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(store.getMessagesForChats).toHaveBeenCalledTimes(1);
    expect(store.getMessagesForChats).toHaveBeenCalledWith([1, 2, 3]);
    expect(store.getMessages).not.toHaveBeenCalled();
    // Only the chat whose stamp moved is read again; an all-memo list reads nothing.
    chats[1] = chat(2, "Two", 1, "2026-11-09T11:00:00Z");
    await runs.list();
    expect(store.getMessagesForChats).toHaveBeenLastCalledWith([2]);
    await runs.list();
    expect(store.getMessagesForChats).toHaveBeenCalledTimes(2);
    expect(store.getMessages).not.toHaveBeenCalled();
  });

  it("reads window by window and stops once AGENT_RUNS_SHOWN runs are found, never reading older windows", async () => {
    const chats = Array.from({ length: CHATS_SCANNED }, (_, i) => chat(i + 1, `Chat ${i + 1}`));
    const messages = new Map<number, BrainMessage[]>(chats.map((c) => [c.id, [msg("user", "go"), step("read_file")]]));
    const store = withBatch(fakeStore(chats, messages), messages);
    const list = await createAgentRuns(store, () => undefined).list();
    expect(list).toHaveLength(AGENT_RUNS_SHOWN);
    const read = store.getMessagesForChats.mock.calls.flatMap(([ids]) => [...ids]);
    expect(store.getMessagesForChats.mock.calls.every(([ids]) => ids.length <= READ_WINDOW)).toBe(true);
    expect(read).toEqual(chats.slice(0, AGENT_RUNS_SHOWN).map((c) => c.id));
  });

  // regression: the drawer sat on "Reading the recorded agent runs…" — one full store read per chat, unbounded.
  it("stops fresh reads once the budget is spent, still answering memo hits, and the next list picks up the rest", async () => {
    const chats = [chat(1, "One"), chat(2, "Two"), chat(3, "Three")];
    const messages = new Map<number, BrainMessage[]>(chats.map((c) => [c.id, [msg("user", "go"), step("read_file")]]));
    const store = fakeStore(chats, messages);
    let clock = 0;
    // Each message read costs 10 ms on this clock; the budget allows the first read only.
    store.getMessages.mockImplementation(async (chatId: number) => { clock += 10; return messages.get(chatId) ?? []; });
    const runs = createAgentRuns(store, () => undefined, { budgetMs: 5, now: () => clock });
    expect((await runs.list()).map((s) => s.id)).toEqual(["1"]);
    expect(store.getMessages).toHaveBeenCalledTimes(1);
    expect((await runs.list()).map((s) => s.id)).toEqual(["1", "2"]);
    expect((await runs.list()).map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(store.getMessages).toHaveBeenCalledTimes(3);
  });

  it("rejects a list whose read hangs and lets the next list (Retry) read afresh", async () => {
    vi.useFakeTimers();
    try {
      const messages = new Map<number, BrainMessage[]>([[1, [msg("user", "go"), step("read_file")]]]);
      const store = fakeStore([chat(1, "One")], messages);
      store.listChats.mockImplementationOnce(() => new Promise(() => undefined)); // never settles
      const runs = createAgentRuns(store, () => undefined, { timeoutMs: 1_000 });
      const stuck = runs.list();
      expect(runs.list()).toBe(stuck); // shared while in flight
      const failed = expect(stuck).rejects.toThrow(AgentRunsTimeoutError);
      await vi.advanceTimersByTimeAsync(1_000);
      await failed;
      expect((await runs.list()).map((s) => s.id)).toEqual(["1"]);
      expect(store.listChats).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("abandons a timed-out list: a read that lands late is neither analysed nor memoised", async () => {
    vi.useFakeTimers();
    try {
      const messages = new Map<number, BrainMessage[]>([[1, [msg("user", "go"), step("read_file")]]]);
      const store = fakeStore([chat(1, "One")], messages);
      let land!: (rows: BrainMessage[]) => void;
      store.getMessages.mockImplementationOnce(() => new Promise<BrainMessage[]>((resolve) => { land = resolve; }));
      const runs = createAgentRuns(store, () => undefined, { timeoutMs: 1_000 });
      const late = expect(runs.list()).rejects.toThrow(AgentRunsTimeoutError);
      await vi.advanceTimersByTimeAsync(1_000);
      await late;
      land(messages.get(1)!); // the hung read finally answers
      await vi.advanceTimersByTimeAsync(0);
      expect(detect).not.toHaveBeenCalled();
      expect((await runs.list()).map((s) => s.id)).toEqual(["1"]); // not a memo hit: read again
      expect(store.getMessages).toHaveBeenCalledTimes(2);
      expect(detect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not share one project's in-flight list with another project", async () => {
    const chats = [chat(1, "One", 1), chat(2, "Two", 2)];
    const messages = new Map<number, BrainMessage[]>(chats.map((c) => [c.id, [msg("user", "go"), step("read_file")]]));
    const store = fakeStore(chats, messages);
    let project = 1;
    const runs = createAgentRuns(store, () => project);
    const first = runs.list();
    project = 2;
    const second = runs.list();
    expect(second).not.toBe(first);
    expect((await first).map((s) => s.id)).toEqual(["1"]);
    expect((await second).map((s) => s.id)).toEqual(["2"]);
  });

  it("falls back to chat-by-chat reads when the batch read fails, still isolating a broken chat", async () => {
    const messages = new Map<number, BrainMessage[]>([[1, [msg("user", "go"), step("read_file")]], [2, [msg("user", "go"), step("read_file")]]]);
    const store = withBatch(fakeStore([chat(1, "One"), chat(2, "Broken")], messages), messages);
    store.getMessagesForChats.mockRejectedValue(new Error("store busy"));
    store.getMessages.mockImplementation(async (chatId: number) => {
      if (chatId === 2) throw new Error("No such local chat: 2");
      return messages.get(chatId) ?? [];
    });
    expect((await createAgentRuns(store, () => undefined).list()).map((s) => s.id)).toEqual(["1"]);
    expect(store.getMessages).toHaveBeenCalledTimes(2);
  });

  it("leaves out a chat whose messages cannot be read instead of failing the list", async () => {
    const messages = new Map<number, BrainMessage[]>([[1, [msg("user", "go"), step("read_file")]], [2, [msg("user", "go"), step("read_file")]]]);
    const store = fakeStore([chat(1, "One"), chat(2, "Broken")], messages);
    store.getMessages.mockImplementation(async (chatId: number) => {
      if (chatId === 2) throw new Error("No such local chat: 2");
      return messages.get(chatId) ?? [];
    });
    expect((await createAgentRuns(store, () => undefined).list()).map((s) => s.id)).toEqual(["1"]);
  });

  it("shares one read between overlapping list calls", async () => {
    const store = fakeStore([chat(1, "One")], new Map([[1, [msg("user", "go"), step("read_file")]]]));
    const runs = createAgentRuns(store, () => undefined);
    const [a, b] = await Promise.all([runs.list(), runs.list()]);
    expect(a).toBe(b);
    expect(store.listChats).toHaveBeenCalledTimes(1);
    await runs.list();
    expect(store.listChats).toHaveBeenCalledTimes(2);
  });

  it("answers null for an unknown or non-run chat", async () => {
    const runs = createAgentRuns(fakeStore([chat(1, "No tools")], new Map([[1, [msg("user", "hi")]]])), () => undefined);
    expect(await runs.report("1")).toBeNull();
    expect(await runs.report("99")).toBeNull();
    expect(await runs.report("nope")).toBeNull();
  });
});
