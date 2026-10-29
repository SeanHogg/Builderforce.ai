/**
 * The reply reserve compaction holds back is the host-neutral floor (20K, on-prem parity)
 * UNLESS the surface's policy states a lower one (`RunPolicy.budgets.reserveTokens`) — the
 * canvas does, because its replies are bounded far below the floor. With the floor alone,
 * a 16K-window run had a budget of 1 token and compacted a transcript of a few hundred.
 */

import { describe, expect, it } from "vitest";
import type { RunMessage, RunPorts } from "../../src/index.js";
import { compactionHook } from "../../src/policy/compaction/index.js";
import { policyCtx } from "../support/policyContext.js";

const rows = (chars: number): RunMessage[] => [
  { role: "system", content: "You operate the board." },
  { role: "user", content: "THE TASK", task: true },
  { role: "assistant", content: "x".repeat(chars) },
  { role: "assistant", content: "y".repeat(chars) },
  { role: "user", content: "go on" },
];

function ctxFor(window: number, chars: number, budgets: { tokens?: number; reserveTokens?: number }) {
  const model: RunPorts["model"] = {
    complete: async () => ({ content: "memory" }),
    window: () => window,
  };
  return policyCtx({
    policy: { budgets: { tokens: 128_000, ...budgets } },
    messages: rows(chars),
    ports: { model, capabilities: { capabilities: new Set() } },
  });
}

describe("compaction reserve", () => {
  it("a canvas reserve (its largest reply, 8K) on a 32K window: a reply that fits is not squeezed, and one that would overflow compacts first", async () => {
    // Budget 32K − 8,192 = ~23.8K tokens of transcript, so the 8K reply always fits the window.
    expect(await compactionHook.compact(ctxFor(32_000, 30_000, { reserveTokens: 8_192 }))).toBeUndefined();
    expect(await compactionHook.compact(ctxFor(32_000, 56_000, { reserveTokens: 8_192 }))).toBeTruthy();
  });

  it("the host-neutral floor leaves a 16K window no room: a small transcript compacts", async () => {
    // ~1K tokens against a window of 16K less the 20K floor.
    expect(await compactionHook.compact(ctxFor(16_000, 2_000, {}))).toBeTruthy();
  });

  it("a surface's own reserve lets a 16K-window run with a small transcript alone", async () => {
    expect(await compactionHook.compact(ctxFor(16_000, 2_000, { reserveTokens: 4_000 }))).toBeUndefined();
  });

  it("a 32K window compacts only near its real budget (window less the stated reserve)", async () => {
    // Budget 32K − 4K = 28K tokens. ~10K tokens fits; ~40K does not.
    expect(await compactionHook.compact(ctxFor(32_000, 20_000, { reserveTokens: 4_000 }))).toBeUndefined();
    expect(await compactionHook.compact(ctxFor(32_000, 80_000, { reserveTokens: 4_000 }))).toBeTruthy();
  });
});
