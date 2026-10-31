/**
 * The bridge tells the session a summary row only for a model HAND-OFF (as the old loop did); an ordinary fold's note is not
 * persisted, because no history is lost to it.
 */

import { describe, expect, it } from "vitest";
import { AgentEventBridge } from "./agentEventBridge.js";

const bridge = () => new AgentEventBridge({ activeModel: () => ({ api: "openai-completions", provider: "p", id: "m" }) as never, onSwap: () => undefined });
const summaries = (b: AgentEventBridge) => b.messages().filter((m) => m.role === "compactionSummary");

describe("a compaction event and the session's summary row", () => {
  it("a hand-off's note (no durable fold behind it) is the summary row, with what the context really cost", () => {
    const b = bridge();
    b.emit({ kind: "context.compacted", step: 3, dropped: 12, beforeTokens: 31_000, afterTokens: 9_000, note: "Handed off from p/m to p/m2.\n[12 earlier messages omitted]" });
    expect(summaries(b)).toMatchObject([{ summary: expect.stringContaining("Handed off from p/m to p/m2."), tokensBefore: 31_000 }]);
  });

  it("an ordinary fold's note (it names the rows it covers) is not persisted", () => {
    const b = bridge();
    b.emit({ kind: "context.compacted", step: 3, dropped: 12, beforeTokens: 31_000, afterTokens: 9_000, note: "memory of the middle", covered: 12 });
    expect(summaries(b)).toEqual([]);
  });
});
