/**
 * Proves the {@link LocalAgentEngine} drives the shared {@link ToolRegistry}
 * end-to-end on Node: a mocked LLM client issues a write_file tool call then finish,
 * and the engine dispatches them through the shared contract + Node provider — with
 * no third-party agent framework anywhere in the path.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCoreToolRegistry } from "@builderforce/agent-tools";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNodeCapabilityProvider } from "./node-capability-provider.js";
import { LocalAgentEngine, type LlmComplete, type RawToolCall } from "./local-agent-engine.js";

let workspace: string;
beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-engine-"));
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

function call(name: string, args: Record<string, unknown>): RawToolCall {
  return { id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

describe("LocalAgentEngine (framework-free)", () => {
  it("runs a write_file → finish loop through the shared registry + Node provider", async () => {
    const registry = buildCoreToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);

    // Scripted model: turn 0 writes a file, turn 1 finishes.
    const turns: Array<{ content: string; toolCalls: RawToolCall[] }> = [
      { content: "writing", toolCalls: [call("write_file", { path: "out/result.ts", content: "export const ok = true;\n" })] },
      { content: "", toolCalls: [call("finish", { summary: "Created out/result.ts" })] },
    ];
    let turn = 0;
    const complete: LlmComplete = async () => turns[turn++] ?? { content: "", toolCalls: [] };

    const engine = new LocalAgentEngine({ registry, provider, complete });
    const result = await engine.run({ systemPrompt: "you are a coder", userContent: "make the file" });

    expect(result.finished).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.output).toBe("Created out/result.ts");
    // The tool actually hit disk via the Node provider.
    expect(await fs.readFile(path.join(workspace, "out/result.ts"), "utf8")).toContain("export const ok = true;");
  });

  it("stops and reports awaitingInput when a tool returns an ask_human control signal", async () => {
    const registry = buildCoreToolRegistry();
    // A provider that backs human → ask_human is offered and pauses.
    const base = buildNodeCapabilityProvider(workspace);
    const provider = {
      ...base,
      capabilities: new Set([...base.capabilities, "human" as const]),
      human: { async ask(question: string) { return { paused: true, approvalId: "ap-1", note: "queued" }; } },
    };
    const complete: LlmComplete = async () => ({
      content: "",
      toolCalls: [call("ask_human", { question: "Which API base?" })],
    });
    const engine = new LocalAgentEngine({ registry, provider, complete });
    const result = await engine.run({ systemPrompt: "s", userContent: "u" });
    expect(result.finished).toBe(false);
    expect(result.awaitingInput).toEqual({ approvalId: "ap-1", question: "Which API base?" });
  });

  it("ends when the model stops requesting tools", async () => {
    const registry = buildCoreToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    const complete: LlmComplete = async () => ({ content: "all done, nothing to do", toolCalls: [] });
    const engine = new LocalAgentEngine({ registry, provider, complete });
    const result = await engine.run({ systemPrompt: "s", userContent: "u" });
    expect(result.finished).toBe(true);
    expect(result.output).toBe("all done, nothing to do");
  });
});
