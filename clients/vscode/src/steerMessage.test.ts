import { describe, expect, it, vi } from "vitest";
import { steerFromMessage } from "./steerMessage";

const inline = (text: string, files: { name: string }[] | undefined) => (files?.length ? `${text} [+${files.length}]` : text);

describe("steerFromMessage - the panel's run.steer", () => {
  it("one message: its text (text attachments inlined) and its attachments go to steer", () => {
    const host = { steer: vi.fn(), steerTurns: vi.fn() };
    const picture = { key: "p", name: "p.png", type: "image/png", imageUrl: "data:x" };
    const note = { key: "n", name: "n.txt", type: "text/plain" };

    steerFromMessage(host, { chatId: 4, text: "go", attachments: [picture, note] }, inline as never);

    expect(host.steer).toHaveBeenCalledWith(4, "go [+1]", [picture, note]);
    expect(host.steerTurns).not.toHaveBeenCalled();
  });

  it("several turns: each is fitted on its own and they go to steerTurns together, with their keys", () => {
    const host = { steer: vi.fn(), steerTurns: vi.fn() };

    steerFromMessage(host, { chatId: 4, turns: [{ text: "a", eventKey: "k1" }, { text: "b", eventKey: "k2", attachments: [{ key: "n", name: "n.txt", type: "text/plain" }] }] }, inline as never);

    expect(host.steerTurns).toHaveBeenCalledTimes(1);
    expect(host.steerTurns).toHaveBeenCalledWith(4, [
      { text: "a", eventKey: "k1" },
      { text: "b [+1]", eventKey: "k2", attachments: [{ key: "n", name: "n.txt", type: "text/plain" }] },
    ]);
    expect(host.steer).not.toHaveBeenCalled();
  });

  it("a turn without text or key is not a turn; nothing valid means nothing is said", () => {
    const host = { steer: vi.fn(), steerTurns: vi.fn() };

    steerFromMessage(host, { chatId: 4, turns: [{ eventKey: "k1" }, { text: "x" }] as never }, inline as never);
    steerFromMessage(host, { chatId: 4 }, inline as never);

    expect(host.steerTurns).not.toHaveBeenCalled();
    expect(host.steer).not.toHaveBeenCalled();
  });
});
