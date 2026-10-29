/**
 * Focused unit tests for the ported packer (`pack.ts`) and the reserve helpers
 * (`reserve.ts`). These cover the packer's invariants directly — the system prefix
 * stays first, the latest directive stays verbatim, tool-call pairing is never broken,
 * the tail takes what fits, the dropped middle becomes ONE note — and the reserve math.
 */

import { describe, expect, it, vi } from "vitest";
import {
  packHandoff,
  handoffBudget,
  defaultEstimateTokens,
  type PackMessage,
} from "../../src/policy/compaction/index.js";
import {
  compactReserveTokens,
  compactionReserve,
  DEFAULT_COMPACT_RESERVE_TOKENS,
  DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR,
} from "../../src/policy/compaction/index.js";

function sys(content: string): PackMessage {
  return { role: "system", content };
}
function user(content: string): PackMessage {
  return { role: "user", content };
}
function assistantToolCall(id: string, name = "read_file"): PackMessage {
  return { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] };
}
function toolResult(id: string, content: string): PackMessage {
  return { role: "tool", tool_call_id: id, content };
}

function assertPairingValid(messages: readonly PackMessage[]): void {
  const announced = new Set<string>();
  for (const m of messages) {
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<{ id?: string }>) if (tc.id) announced.add(tc.id);
    }
    if (m.role === "tool") {
      expect(announced.has(String(m.tool_call_id)), `orphan tool message ${String(m.tool_call_id)}`).toBe(true);
    }
  }
}

describe("packHandoff", () => {
  it("is a no-op when the transcript already fits", async () => {
    const msgs = [sys("S"), user("do the thing"), assistantToolCall("c1"), toolResult("c1", "small")];
    const r = await packHandoff({ messages: msgs, targetContextTokens: 100_000, reserveOutputTokens: 0 });
    expect(r.dropped).toBe(0);
    expect(r.fits).toBe(true);
    expect(r.messages).toEqual(msgs);
    expect(r.summarized).toBe(false);
  });

  it("keeps the system prefix first and the latest user directive verbatim", async () => {
    const directive = user("the latest directive");
    const msgs = [
      sys("sys"),
      user("old task brief"),
      assistantToolCall("c1"),
      toolResult("c1", "X".repeat(30_000)),
      directive,
    ];
    const r = await packHandoff({ messages: msgs, targetContextTokens: 2_000, reserveOutputTokens: 0 });
    expect(r.messages[0]).toEqual(sys("sys"));
    expect(r.messages).toContainEqual(directive);
    // The directive appears exactly once and verbatim (not folded into the note).
    expect(r.messages.filter((m) => m === directive || (m.role === "user" && m.content === "the latest directive"))).toHaveLength(1);
  });

  it("never breaks tool-call pairing when the budget cuts mid-round", async () => {
    const msgs: PackMessage[] = [sys("sys"), user("task")];
    for (let i = 0; i < 6; i++) msgs.push(assistantToolCall(`c${i}`), toolResult(`c${i}`, "Y".repeat(6_000)));
    const r = await packHandoff({ messages: msgs, targetContextTokens: 3_000, reserveOutputTokens: 0 });
    assertPairingValid(r.messages);
    // Every surviving assistant tool-call has its results, and no orphan tool rows.
    expect(r.messages.filter((m) => m.role === "tool")).toHaveLength(
      r.messages.filter((m) => Array.isArray(m.tool_calls)).length,
    );
  });

  it("collapses the dropped middle into ONE note that keeps turns alternating", async () => {
    const msgs: PackMessage[] = [sys("sys"), user("task")];
    for (let i = 0; i < 6; i++) msgs.push(assistantToolCall(`c${i}`), toolResult(`c${i}`, "Z".repeat(8_000)));
    const r = await packHandoff({ messages: msgs, targetContextTokens: 3_000, reserveOutputTokens: 0 });
    expect(r.dropped).toBeGreaterThan(0);
    const notes = r.messages.filter((m) => typeof m.content === "string" && /omitted|Compressed|Handed/.test(m.content as string));
    expect(notes.length).toBeLessThanOrEqual(1);
    // No two assistant turns in a row (the note's role keeps turns alternating).
    for (let i = 1; i < r.messages.length; i++) {
      expect(r.messages[i - 1]!.role === "assistant" && r.messages[i]!.role === "assistant").toBe(false);
    }
  });

  it("uses the summarizer for the note and reports summarized", async () => {
    const summarize = vi.fn(async () => "- did the thing");
    const msgs: PackMessage[] = [sys("sys"), user("task")];
    for (let i = 0; i < 6; i++) msgs.push(assistantToolCall(`c${i}`), toolResult(`c${i}`, "Z".repeat(8_000)));
    const r = await packHandoff({
      messages: msgs,
      targetContextTokens: 3_000,
      reserveOutputTokens: 0,
      summarize,
    });
    expect(summarize).toHaveBeenCalledOnce();
    expect(r.summarized).toBe(true);
    expect(r.messages.some((m) => typeof m.content === "string" && (m.content as string).includes("did the thing"))).toBe(true);
    assertPairingValid(r.messages);
  });

  it("pins the task brief even when a later nudge is the latest directive", async () => {
    const brief = user("the original task brief");
    const nudge = user("keep going");
    const msgs: PackMessage[] = [sys("sys"), brief];
    for (let i = 0; i < 4; i++) msgs.push(assistantToolCall(`c${i}`), toolResult(`c${i}`, "Z".repeat(6_000)));
    msgs.push(nudge, assistantToolCall("c9"), toolResult("c9", "Z".repeat(6_000)));
    const pinned = await packHandoff({
      messages: msgs,
      targetContextTokens: 2_500,
      reserveOutputTokens: 0,
      pinned: (m) => m === brief,
    });
    expect(pinned.messages).toContain(brief);
    expect(pinned.messages).toContain(nudge);
    assertPairingValid(pinned.messages);
  });

  it("reports fits:false when the system prefix + directive alone exceed the budget", async () => {
    const big = sys("S".repeat(20_000));
    const directive = user("D".repeat(10_000));
    const r = await packHandoff({ messages: [big, directive], targetContextTokens: 1_000, reserveOutputTokens: 0 });
    expect(r.fits).toBe(false);
    expect(r.messages).toContainEqual(big);
    expect(r.messages).toContainEqual(directive);
  });
});

describe("handoffBudget + estimator", () => {
  it("subtracts the reserve and the tool schemas, floored at zero", () => {
    expect(handoffBudget({ targetContextTokens: 100_000, reserveOutputTokens: 4_096 })).toBe(95_904);
    expect(handoffBudget({ targetContextTokens: 100_000, reserveOutputTokens: 4_096, toolsTokens: 2_000 })).toBe(93_904);
    expect(handoffBudget({ targetContextTokens: 1_000, reserveOutputTokens: 4_096 })).toBe(0);
  });

  it("defaultEstimateTokens is chars/4 rounded up", () => {
    expect(defaultEstimateTokens("")).toBe(0);
    expect(defaultEstimateTokens("abcd")).toBe(1);
    expect(defaultEstimateTokens("abcde")).toBe(2);
  });
});

describe("reserve tokens", () => {
  it("compactReserveTokens returns maxTokens when set, else the default", () => {
    expect(compactReserveTokens(undefined)).toBe(DEFAULT_COMPACT_RESERVE_TOKENS);
    expect(compactReserveTokens(0)).toBe(DEFAULT_COMPACT_RESERVE_TOKENS);
    expect(compactReserveTokens(8_192)).toBe(8_192);
  });

  it("compactionReserve raises the reply reserve to on-prem's 20,000 floor, or the configured one", () => {
    expect(compactionReserve(undefined)).toBe(DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR);
    expect(compactionReserve(32_000)).toBe(32_000);
    expect(compactionReserve(undefined, { agents: { defaults: { compaction: { reserveTokensFloor: 0 } } } })).toBe(DEFAULT_COMPACT_RESERVE_TOKENS);
  });
});
