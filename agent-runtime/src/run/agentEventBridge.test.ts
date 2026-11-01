/**
 * The bridge tells the session nothing about a context fold: the hand-off note stays in the run's own transcript, where the incoming
 * model reads it. What it does say is a warning a person must be able to read: a context that could not be made to fit.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../logger.js", () => ({ logWarn: warn, logInfo: vi.fn(), logDebug: vi.fn(), logError: vi.fn() }));

import { AgentEventBridge } from "./agentEventBridge.js";

const bridge = () => new AgentEventBridge({ activeModel: () => ({ api: "openai-completions", provider: "p", id: "m" }) as never, onSwap: () => undefined });

beforeEach(() => warn.mockClear());

describe("a compaction event", () => {
  it("adds nothing to the session's messages, hand-off or ordinary fold", () => {
    const b = bridge();
    b.emit({ kind: "context.compacted", step: 3, dropped: 12, beforeTokens: 31_000, afterTokens: 9_000, note: "Handed off from p/m to p/m2.\n[12 earlier messages omitted]" });
    b.emit({ kind: "context.compacted", step: 4, dropped: 3, note: "memory of the middle", covered: 3 });
    expect(b.messages()).toEqual([]);
  });
});

describe("a context that cannot be made to fit", () => {
  it("is logged as a warning", () => {
    bridge().emit({ kind: "model.preflight", step: 3, status: "degraded", notices: ["The context cannot be made to fit p/m2 (8000 tokens)."] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cannot be made to fit p/m2"));
  });

  it("an ordinary preflight says nothing", () => {
    bridge().emit({ kind: "model.preflight", step: 1, status: "ok", notices: [] });
    expect(warn).not.toHaveBeenCalled();
  });
});
