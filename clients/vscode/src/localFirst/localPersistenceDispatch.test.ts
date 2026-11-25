import { beforeEach, describe, expect, it, vi } from "vitest";

const submitLocalTurnVerdict = vi.fn(() => true);
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ submitLocalTurnVerdict }));

const { callLocalPersistence } = await import("./localPersistenceDispatch");

describe("callLocalPersistence — E5 rating verdict on the extension host", () => {
  const persistence = { setMessageFeedback: vi.fn(async () => ({})), getChat: vi.fn(async () => ({})) };
  beforeEach(() => submitLocalTurnVerdict.mockClear());

  it("resolves the latest reply's verdict here, where the model stream runs", async () => {
    const answer = await callLocalPersistence(persistence, "setMessageFeedback", [4, "down", { toolName: null, localVerdict: { chatId: 7, passed: false } }]);
    expect(answer.ok).toBe(true);
    expect(submitLocalTurnVerdict).toHaveBeenCalledWith(7, false);
  });

  it("submits nothing for a rating without a verdict, a malformed one, or another method", async () => {
    await callLocalPersistence(persistence, "setMessageFeedback", [2, "up", { toolName: "read_file" }]);
    await callLocalPersistence(persistence, "setMessageFeedback", [2, "up", { localVerdict: { chatId: "7", passed: true } }]);
    await callLocalPersistence(persistence, "getChat", [1, "up", { localVerdict: { chatId: 7, passed: true } }]);
    expect(submitLocalTurnVerdict).not.toHaveBeenCalled();
  });
});
