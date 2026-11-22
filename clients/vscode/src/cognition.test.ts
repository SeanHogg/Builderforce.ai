import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rememberProjectFact: vi.fn(async (..._args: unknown[]) => ({ ok: true }) as { ok: boolean; reason?: string }),
  recallProjectFacts: vi.fn(async () => []),
}));

vi.mock("vscode", () => ({}));
vi.mock("./bfApi", () => mocks);

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
});
