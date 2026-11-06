import { describe, expect, it } from "vitest";
import type { BrainTraceEvent } from "@seanhogg/builderforce-brain-embedded";
import { createLlmFailureLogger, llmFailureLine } from "./llmFailureLog";

const failed = (args: Record<string, unknown>, result = "StreamInterruptedError: Kimi Code (api.kimi.ai) sent no response for 240s"): BrainTraceEvent => ({
  ts: "", category: "error", label: "llm.complete", isError: true, args, result,
});

describe("llmFailureLine", () => {
  it("names the model, the error and the request detail", () => {
    const line = llmFailureLine(failed({
      model: "local/kimi-code/k3",
      failure: {
        phase: "headers", destination: { kind: "provider", label: "Kimi Code", host: "api.kimi.ai" },
        elapsedMs: 240_000, idleMs: 240_000, requestBytes: 1024, messageCount: 3, toolCount: 2, credential: "resolved",
      },
    }));
    expect(line.startsWith("[llm] local/kimi-code/k3 failed: StreamInterruptedError: Kimi Code")).toBe(true);
    expect(line).toContain(" — destination Kimi Code (api.kimi.ai) · no response headers · after 240s");
  });

  it("still logs a failure that carries no detail", () => {
    expect(llmFailureLine(failed({}, "boom"))).toBe("[llm] default failed: boom");
  });
});

describe("createLlmFailureLogger", () => {
  it("logs each failed completion once, ignoring successes and other steps", () => {
    const lines: string[] = [];
    const log = createLlmFailureLogger((l) => lines.push(l));
    const one = failed({ model: "m" });
    const ok: BrainTraceEvent = { ts: "", category: "llm", label: "llm.complete", args: { model: "m" } };
    log([ok, one]);
    log([ok, one, failed({ model: "n" })]);
    expect(lines).toHaveLength(2);
  });
});
