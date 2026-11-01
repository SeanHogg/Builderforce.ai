import { IMAGE_CHAR_ESTIMATE } from "@builderforce/agent-run";
import { estimateTokensFromChars } from "@builderforce/workload";
import { describe, expect, it } from "vitest";
import { estimateTokens } from "./compaction.js";

describe("the session's token estimate prices a picture at the ONE shared figure", () => {
  it("a tool result's picture costs what every other estimate in the product says it does", () => {
    const result = { role: "toolResult" as const, toolCallId: "c", toolName: "screenshot", content: [{ type: "image" as const, mimeType: "image/png", data: "A".repeat(5_000_000) }], details: {}, isError: false, timestamp: 0 };
    expect(estimateTokens(result)).toBe(estimateTokensFromChars(IMAGE_CHAR_ESTIMATE));
  });
});
