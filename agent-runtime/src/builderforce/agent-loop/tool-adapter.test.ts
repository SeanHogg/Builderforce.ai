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

describe("streaming — the seam a converged exec/process needs", () => {
  /**
   * The native `AgentTool.execute` has always taken an `onUpdate` callback, and the
   * adapter used to drop it: a shared tool ran to completion in silence and the terminal
   * looked hung. That is why `exec`/`process` could not converge without regressing.
   */
  const streamingDef: ToolDefinition = {
    name: "stream",
    requires: [],
    schema: {
      type: "function",
      function: { name: "stream", description: "streams", parameters: { type: "object", properties: {} } },
    },
    execute: async (_args, ctx) => {
      ctx.onUpdate?.({ data: { chunk: 1 } });
      ctx.onUpdate?.({ data: { chunk: 2 }, content: [{ type: "text", text: "partial" }] });
      return { data: { done: true } };
    },
  };

  it("forwards partial results to the loop's onUpdate callback", async () => {
    const tool = toAgentTool(streamingDef, provider, "/work");
    const seen: unknown[] = [];
    const result = await tool.execute("call1", {}, undefined, (partial) => seen.push(partial));

    expect(seen).toHaveLength(2);
    // Partials are mapped through the SAME result mapper as the final value, so a host
    // renders progress with the code path it already uses.
    expect((seen[0] as { content: Array<{ text: string }> }).content[0].text).toBe(
      JSON.stringify({ chunk: 1 }),
    );
    expect((seen[1] as { content: Array<{ text: string }> }).content[1].text).toBe('partial');
    expect(result.content[0]).toEqual({ type: "text", text: JSON.stringify({ done: true }) });
  });

  it("runs to completion when the loop supplies NO callback — nobody is watching", async () => {
    const tool = toAgentTool(streamingDef, provider, "/work");
    const result = await tool.execute("call1", {});
    expect(result.content[0]).toEqual({ type: "text", text: JSON.stringify({ done: true }) });
  });
});
