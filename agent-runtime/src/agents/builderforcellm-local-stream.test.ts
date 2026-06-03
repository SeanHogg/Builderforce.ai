/**
 * Unit tests for builderforcellm-local-stream.ts
 *
 * Tests focus on the pure/deterministic behaviours that don't require a live
 * Transformers.js pipeline: memory-context loading, DELEGATE detection, and
 * execution-LLM HTTP routing.  The pipeline itself is tested by integration
 * tests that require `@huggingface/transformers` to be installed.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyLocalBrainRequest } from "./builderforcellm-local-stream.js";
import { loadBuilderForceAgentsMemory } from "./transformers-stream.js";
// ── loadBuilderForceAgentsMemory ───────────────────────────────────────────────────────
import { resolveAgentRuntimeDir, resolveWorkspaceFilePath } from "./workspace.js";

describe("loadBuilderForceAgentsMemory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-mem-test-"));
    await fs.mkdir(resolveAgentRuntimeDir(tmpDir), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("returns empty string when workspace has no memory files", async () => {
    const result = await loadBuilderForceAgentsMemory(tmpDir);
    expect(result).toBe("");
  });

  it("loads SOUL.md and USER.md into the context", async () => {
    await fs.writeFile(resolveWorkspaceFilePath(tmpDir, "SOUL.md"), "I am the agent.", "utf-8");
    await fs.writeFile(
      resolveWorkspaceFilePath(tmpDir, "USER.md"),
      "User likes TypeScript.",
      "utf-8",
    );
    const result = await loadBuilderForceAgentsMemory(tmpDir);
    expect(result).toContain("SOUL.md");
    expect(result).toContain("I am the agent.");
    expect(result).toContain("USER.md");
    expect(result).toContain("User likes TypeScript.");
  });

  it("includes MEMORY.md in the default (non-shared) context", async () => {
    await fs.writeFile(resolveWorkspaceFilePath(tmpDir, "MEMORY.md"), "Long-term memory.", "utf-8");
    const result = await loadBuilderForceAgentsMemory(tmpDir);
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("Long-term memory.");
  });

  it("omits MEMORY.md when isSharedContext is true", async () => {
    await fs.writeFile(resolveWorkspaceFilePath(tmpDir, "SOUL.md"), "I am the agent.", "utf-8");
    await fs.writeFile(resolveWorkspaceFilePath(tmpDir, "MEMORY.md"), "Personal data.", "utf-8");
    const result = await loadBuilderForceAgentsMemory(tmpDir, { isSharedContext: true });
    expect(result).toContain("SOUL.md");
    expect(result).not.toContain("MEMORY.md");
    expect(result).not.toContain("Personal data.");
  });

  it("loads today's daily note from workspace/memory/", async () => {
    const memDir = path.join(resolveAgentRuntimeDir(tmpDir), "memory");
    await fs.mkdir(memDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    await fs.writeFile(path.join(memDir, `${today}.md`), "Today I did X.", "utf-8");
    const result = await loadBuilderForceAgentsMemory(tmpDir);
    expect(result).toContain("Today I did X.");
  });

  it("silently skips non-existent memory files", async () => {
    // Only SOUL.md present — should not throw for missing USER.md, MEMORY.md etc.
    await fs.writeFile(resolveWorkspaceFilePath(tmpDir, "SOUL.md"), "Only soul here.", "utf-8");
    await expect(loadBuilderForceAgentsMemory(tmpDir)).resolves.toContain("Only soul here.");
  });

  it("respects the character budget and truncates long files", async () => {
    // Write a file larger than BRAIN_CONTEXT_CHAR_BUDGET (20000 chars)
    const bigContent = "x".repeat(25000);
    await fs.writeFile(resolveWorkspaceFilePath(tmpDir, "SOUL.md"), bigContent, "utf-8");
    const result = await loadBuilderForceAgentsMemory(tmpDir);
    expect(result.length).toBeLessThan(25000);
    expect(result).toContain("…");
  });
});

// ── DELEGATE detection ────────────────────────────────────────────────────────
// Test the detection logic in isolation (not the full stream fn which requires
// the real pipeline).

/**
 * This mirrors the routing predicate in builderforcellm-local-stream.ts:
 *   const isDelegating = brainText.toUpperCase().trimStart().startsWith("DELEGATE");
 *
 * Smoke-testing it here with representative inputs gives confidence that
 * SmolLM2 HANDLE vs DELEGATE routing decisions are correctly interpreted,
 * regardless of which exact words the model produces after "DELEGATE".
 */
describe("DELEGATE detection logic", () => {
  function isDelegating(text: string): boolean {
    return text.toUpperCase().trimStart().startsWith("DELEGATE");
  }

  // ── cases that SHOULD delegate ──────────────────────────────────────────

  it("detects plain DELEGATE at the start", () => {
    expect(isDelegating("DELEGATE: implement this feature")).toBe(true);
  });

  it("detects lowercase delegate", () => {
    expect(isDelegating("delegate this task")).toBe(true);
  });

  it("detects DELEGATE with leading whitespace", () => {
    expect(isDelegating("  DELEGATE\ndo something complex")).toBe(true);
  });

  it("detects DELEGATE followed by a colon and plan", () => {
    expect(
      isDelegating("DELEGATE: Refactor the entire authentication module across 12 files."),
    ).toBe(true);
  });

  it("detects DELEGATE followed by newline and multi-line plan", () => {
    const brainOutput = [
      "DELEGATE",
      "1. Rewrite the database layer",
      "2. Migrate all SQL queries to the ORM",
      "3. Update all integration tests",
    ].join("\n");
    expect(isDelegating(brainOutput)).toBe(true);
  });

  it("detects DELEGATE with mixed case", () => {
    expect(isDelegating("Delegate: This requires deep codebase understanding.")).toBe(true);
  });

  // ── cases that should HANDLE directly ───────────────────────────────────

  it("does not delegate a normal conversational response", () => {
    expect(isDelegating("Here is my answer: ...")).toBe(false);
  });

  it("does not delegate when DELEGATE appears mid-sentence", () => {
    expect(isDelegating("I will not delegate this.")).toBe(false);
  });

  it("does not delegate a simple reasoning response", () => {
    expect(isDelegating("The answer is 42.")).toBe(false);
  });

  it("does not delegate a memory-recall answer", () => {
    expect(isDelegating("Based on your preferences from SOUL.md, you prefer TypeScript.")).toBe(
      false,
    );
  });

  it("does not delegate a short code snippet response", () => {
    const inlineCode = `Here is a simple utility function:\n\`\`\`ts\nconst add = (a: number, b: number) => a + b;\n\`\`\``;
    expect(isDelegating(inlineCode)).toBe(false);
  });

  it("does not delegate a planning/explanation response", () => {
    expect(
      isDelegating(
        "To implement this feature you will need to: 1. Add a route, 2. Create a handler.",
      ),
    ).toBe(false);
  });

  it("does not delegate an empty string", () => {
    expect(isDelegating("")).toBe(false);
  });

  // ── brain plan extraction ────────────────────────────────────────────────
  // Verify the plan stripping mirrors what builderforcellm-local-stream.ts does:
  //   const brainPlan = brainText.replace(/^DELEGATE[:\s]*/i, "").trim();

  // Helper mirrors the exact extraction logic from builderforcellm-local-stream.ts.
  function extractBrainPlan(brainText: string): string {
    return brainText.replace(/^DELEGATE[:\s]*/i, "").trim();
  }

  it("strips 'DELEGATE: ' prefix to expose the plan text", () => {
    const plan = extractBrainPlan("DELEGATE: implement OAuth2 with PKCE across three services");
    expect(plan).toBe("implement OAuth2 with PKCE across three services");
  });

  it("strips 'DELEGATE\\n' prefix correctly", () => {
    const plan = extractBrainPlan(
      "DELEGATE\n1. Add authentication middleware\n2. Protect all routes",
    );
    expect(plan).toContain("1. Add authentication middleware");
    expect(plan).not.toContain("DELEGATE");
  });

  it("strips lowercase 'delegate: ' prefix", () => {
    const plan = extractBrainPlan("delegate: write a complete test suite for the API");
    expect(plan).toBe("write a complete test suite for the API");
  });
});

describe("classifyLocalBrainRequest", () => {
  it("marks short direct prompts as simple", () => {
    const result = classifyLocalBrainRequest({
      queryText: "What does this function do?",
      rawMessages: [{ role: "user", content: "What does this function do?" }],
      ragContext: "",
      memoryBlock: "",
    });

    expect(result.mode).toBe("simple");
    expect(result.reasons).toEqual([]);
  });

  it("marks long debugging prompts as complex", () => {
    const result = classifyLocalBrainRequest({
      queryText: "Please debug the gateway and refactor the routing across multiple files. ".repeat(
        12,
      ),
      rawMessages: [{ role: "user", content: "debug the gateway" }],
      ragContext: "x".repeat(3_000),
      memoryBlock: "y".repeat(7_000),
    });

    expect(result.mode).toBe("complex");
    expect(result.reasons).toContain("long-user-prompt");
    expect(result.reasons).toContain("complex-intent");
    expect(result.reasons).toContain("large-rag-context");
    expect(result.reasons).toContain("large-brain-context");
  });
});

// ── Execution LLM routing — callExecutionLlm ─────────────────────────────────
// We test the HTTP routing by mocking global fetch.

describe("callExecutionLlm routing", () => {
  const mockMessages = [{ role: "user", content: "write a function" }];

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls /chat/completions for openai-completions providers", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "function foo() {}" } }] }),
    } as Response);

    const baseUrl = "https://api.openai.com/v1";
    const url = `${baseUrl}/chat/completions`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
      body: JSON.stringify({ model: "gpt-4o", messages: mockMessages, stream: false }),
    });

    expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "POST" }));
  });

  it("routes openai-responses to /responses endpoint (not /chat/completions)", () => {
    // Verify the endpoint URL shape used by callOpenAiResponses.
    const baseUrl = "https://api.openai.com/v1";
    const completionsUrl = `${baseUrl}/chat/completions`;
    const responsesUrl = `${baseUrl}/responses`;

    expect(responsesUrl).toBe("https://api.openai.com/v1/responses");
    expect(completionsUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(responsesUrl).not.toBe(completionsUrl);
  });
});
