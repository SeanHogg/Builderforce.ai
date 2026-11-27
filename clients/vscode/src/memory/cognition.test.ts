import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rememberProjectFact: vi.fn(async (..._args: unknown[]) => ({ ok: true }) as { ok: boolean; reason?: string }),
  recallProjectFacts: vi.fn(async (..._args: unknown[]) => [] as Array<{ key: string; content: string }>),
}));

vi.mock("vscode", () => ({}));
vi.mock("../bfApi", () => mocks);

import { cognitionToolDefs } from "./cognition";

const secrets = {} as never;

function rememberTool(serverChatId?: () => Promise<number | undefined>) {
  return cognitionToolDefs(secrets, 7, serverChatId).find((t) => t.name === "remember_fact")!;
}

describe("remember_fact", () => {
  beforeEach(() => {
    mocks.rememberProjectFact.mockReset();
    mocks.rememberProjectFact.mockResolvedValue({ ok: true });
  });

  it("writes with the run's server chat id so the Memory gate and origin apply", async () => {
    const out = await rememberTool(async () => 4242).execute({ key: "k", content: "c" }, "/repo");
    expect(mocks.rememberProjectFact).toHaveBeenCalledWith(secrets, 7, "k", "c", { chatId: 4242 });
    expect(JSON.parse(out)).toMatchObject({ ok: true, key: "k" });
    expect(out).toContain("Remembered 'k'");
  });

  it("writes without meta when the chat is not bound to a server chat", async () => {
    await rememberTool(async () => undefined).execute({ key: "k", content: "c" }, "/repo");
    expect(mocks.rememberProjectFact).toHaveBeenCalledWith(secrets, 7, "k", "c", undefined);
  });

  it("says Memory is OFF for the chat when the server refuses with memory-off", async () => {
    mocks.rememberProjectFact.mockResolvedValue({ ok: false, reason: "memory-off" });
    const out = await rememberTool(async () => 4242).execute({ key: "k", content: "c" }, "/repo");
    expect(JSON.parse(out)).toMatchObject({ ok: false, error: expect.stringContaining("Memory is OFF for this chat") });
    expect(out).not.toContain("unavailable");
  });

  it("still reports unavailable for any other failure", async () => {
    mocks.rememberProjectFact.mockResolvedValue({ ok: false });
    const out = await rememberTool().execute({ key: "k", content: "c" }, "/repo");
    expect(JSON.parse(out)).toMatchObject({ ok: false, error: expect.stringContaining("unavailable") });
  });

  it("keeps the write project-scoped when the call includes a wider model scope", async () => {
    const tool = rememberTool(async () => 4242);
    expect(tool.wireName).toBe("memory__remember");
    expect(tool.mutating).toBe(true);
    expect(Object.keys(tool.parameters.properties as object)).toEqual(["key", "content"]);
    const out = await tool.execute({ key: "k", content: "c", scope: "tenant", ttl_days: 1 }, "/repo");
    expect(JSON.parse(out)).toMatchObject({ ok: true, key: "k" });
    expect(mocks.rememberProjectFact).toHaveBeenCalledWith(secrets, 7, "k", "c", { chatId: 4242 });
  });

  it("refuses to write if resolving the server chat gate throws", async () => {
    const out = await rememberTool(async () => { throw new Error("bind unavailable"); }).execute({ key: "k", content: "c" }, "/repo");
    expect(JSON.parse(out)).toMatchObject({ ok: false, error: expect.stringContaining("unavailable") });
    expect(mocks.rememberProjectFact).not.toHaveBeenCalled();
  });
});

it("recalls through the shared tool and keeps the saved empty-query and facts envelope", async () => {
  const recall = cognitionToolDefs(secrets, 7).find((tool) => tool.name === "recall_facts")!;
  expect(recall.wireName).toBe("memory__recall");
  expect(recall.mutating).toBe(false);
  const facts = [{ key: "k", content: "Use the same project store." }];
  mocks.recallProjectFacts.mockResolvedValue(facts);
  const result = await recall.execute({ query: " notes ", limit: 100 }, "");
  expect(mocks.recallProjectFacts).toHaveBeenLastCalledWith(secrets, 7, "notes", 20);
  expect(JSON.parse(result)).toEqual({ ok: true, query: "notes", total: 1, facts });
  const saved = await recall.execute({ query: "" }, "");
  expect(mocks.recallProjectFacts).toHaveBeenLastCalledWith(secrets, 7, undefined, 5);
  expect(JSON.parse(saved)).toEqual({ ok: true, query: "", total: 1, facts });
});
