/**
 * Compaction on a surface whose turns a person watches (PRD 35 WS4, the canvas):
 *   • the dropped middle is summarised through `ModelTransport.summarize` when the
 *     transport has one — a summary is not a turn, so it must not take the path that
 *     streams to the screen — and through `complete` otherwise;
 *   • the row the surface marks as THE TASK is the one compaction pins, so a transcript
 *     that opens with a prior conversation keeps the current request, not an old message.
 */

import { describe, expect, it } from "vitest";
import type { ModelCompletion, ModelRequest, RunMessage, RunPorts } from "../../src/index.js";
import { compactionHook } from "../../src/policy/compaction/index.js";
import { policyCtx } from "../support/policyContext.js";

const BULK = "x".repeat(2_400);

/** An old conversation, then the current task, then bulky work and a nudge. */
const TRANSCRIPT: RunMessage[] = [
  { role: "system", content: "You operate the board." },
  { role: "user", content: "OLD QUESTION from an earlier turn" },
  { role: "assistant", content: BULK },
  { role: "user", content: "THE CURRENT TASK", task: true },
  { role: "assistant", content: BULK },
  { role: "assistant", content: BULK },
  { role: "user", content: "keep going" },
];

function portsWith(model: RunPorts["model"]): Partial<RunPorts> {
  return { model, capabilities: { capabilities: new Set() } };
}

function recorder() {
  const calls: Array<{ via: "complete" | "summarize"; request: ModelRequest }> = [];
  const summary: ModelCompletion = { content: "A short memory of the earlier steps." };
  return { calls, summary };
}

describe("compaction summarizer", () => {
  it("uses the transport's own summarize path when it has one, never complete", async () => {
    const { calls, summary } = recorder();
    const model: RunPorts["model"] = {
      complete: async (request) => { calls.push({ via: "complete", request }); return summary; },
      summarize: async (request) => { calls.push({ via: "summarize", request }); return summary; },
    };
    const ctx = policyCtx({ policy: { budgets: { tokens: 1_200 } }, messages: TRANSCRIPT, ports: portsWith(model) });

    const result = await compactionHook.compact(ctx);

    expect(result).toBeTruthy();
    expect(calls.map((call) => call.via)).toEqual(["summarize"]);
    // The summary job's own bound, not the turn's.
    expect(calls[0]?.request.maxTokens).toBe(700);
  });

  it("falls back to complete when the transport has no summarize", async () => {
    const { calls, summary } = recorder();
    const model: RunPorts["model"] = {
      complete: async (request) => { calls.push({ via: "complete", request }); return summary; },
    };
    const ctx = policyCtx({ policy: { budgets: { tokens: 1_200 } }, messages: TRANSCRIPT, ports: portsWith(model) });

    await compactionHook.compact(ctx);

    expect(calls.map((call) => call.via)).toEqual(["complete"]);
  });
});

describe("compaction pins the marked task row", () => {
  it("keeps the current request, still marked, when the transcript opens with an older user message", async () => {
    const model: RunPorts["model"] = {
      complete: async () => ({ content: "memory" }),
      summarize: async () => ({ content: "memory" }),
    };
    const ctx = policyCtx({ policy: { budgets: { tokens: 1_200 } }, messages: TRANSCRIPT, ports: portsWith(model) });

    const result = await compactionHook.compact(ctx);

    const kept = result?.messages ?? [];
    expect(kept.find((row) => row.content === "THE CURRENT TASK")).toMatchObject({ role: "user", task: true });
    expect(kept.some((row) => row.content === "OLD QUESTION from an earlier turn")).toBe(false);
  });
});
