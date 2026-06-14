import type { CapabilityProvider, ToolDefinition } from "@builderforce/agent-tools";
import { describe, expect, it } from "vitest";
import { toAgentTool } from "./tool-adapter.js";

const provider: CapabilityProvider = { capabilities: new Set() } as CapabilityProvider;

const fakeDef: ToolDefinition = {
  name: "echo",
  requires: [],
  schema: {
    type: "function",
    function: {
      name: "echo",
      description: "echoes",
      parameters: { type: "object", properties: { text: { type: "string" } } },
    },
  },
  execute: async (args) => ({ data: { ok: true, echoed: args.text } }),
};

describe("ToolDefinition -> AgentTool adapter", () => {
  it("wraps a shared tool into a native AgentTool that runs and maps the result", async () => {
    const tool = toAgentTool(fakeDef, provider, "/work");
    expect(tool.name).toBe("echo");
    expect(tool.label).toBe("echo");
    expect(tool.description).toBe("echoes");

    const result = await tool.execute("call1", { text: "hi" });
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ ok: true, echoed: "hi" }),
    });
    // full ToolResult rides in details for engine-level control handling
    expect((result.details as { data: { echoed: string } }).data.echoed).toBe("hi");
  });

  it("maps media content blocks to native image blocks", async () => {
    const mediaDef: ToolDefinition = {
      name: "snap",
      requires: [],
      schema: {
        type: "function",
        function: { name: "snap", description: "", parameters: { type: "object" } },
      },
      execute: async () => ({
        data: { ok: true },
        content: [{ type: "media", mediaType: "image", base64: "AAAA", mimeType: "image/jpeg" }],
      }),
    };
    const tool = toAgentTool(mediaDef, provider);
    const result = await tool.execute("c", {});
    expect(result.content).toContainEqual({ type: "image", data: "AAAA", mimeType: "image/jpeg" });
  });
});
