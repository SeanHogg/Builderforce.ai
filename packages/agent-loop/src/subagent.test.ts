import { describe, expect, it, vi } from "vitest";
import { runSubagent, subagentSystemPrompt, SUBAGENT_MAX_STEPS, SUBAGENT_OUTPUT_CHARS } from "./subagent.js";
import type { LoopTurnResult, ParsedToolCall } from "./types.js";

/**
 * A sub-agent is the same kernel one level down, so what is worth testing here is not
 * the iteration (that is `loop.test.ts`) but the CONTRACT the parent depends on: the
 * child starts from its brief alone, its answer is capped, running out of budget is
 * reported rather than disguised as an answer, and a cancelled parent takes the child
 * with it.
 */

const answer = (content: string): LoopTurnResult => ({ content, toolCalls: [] });
const callTool = (name: string, args = "{}"): LoopTurnResult => ({
  content: "",
  toolCalls: [{ id: `c-${name}`, name, arguments: args }],
});

describe("subagentSystemPrompt", () => {
  it("tells a read-only child it may not change anything", () => {
    expect(subagentSystemPrompt(true)).toContain("READ-ONLY");
  });

  it("tells a writable child to make the change and stop there", () => {
    const prompt = subagentSystemPrompt(false);
    expect(prompt).not.toContain("READ-ONLY");
    expect(prompt).toContain("nothing beyond it");
  });

  it("says the parent sees only the final answer — the reason a brief must stand alone", () => {
    expect(subagentSystemPrompt(true)).toContain("must stand alone");
  });
});

describe("runSubagent", () => {
  it("starts the child from its brief and nothing else", async () => {
    const complete = vi.fn(async () => answer("the middleware is in src/auth.ts"));
    const run = await runSubagent({
      task: "find the auth middleware",
      readOnly: true,
      tools: [],
      complete,
      dispatch: async () => ({ data: {} }),
    });

    expect(run.ok).toBe(true);
    expect(run.output).toBe("the middleware is in src/auth.ts");
    // Two rows: the standing instructions and the brief. No parent history.
    const sent = complete.mock.calls[0]![0].messages;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ role: "system" });
    expect(sent[1]).toMatchObject({ role: "user", content: "find the auth middleware" });
  });

  it("runs the child's tool calls through the injected dispatcher", async () => {
    const dispatch = vi.fn(async (_call: ParsedToolCall) => ({ data: { ok: true, paths: ["src/auth.ts"] } }));
    let turn = 0;
    const run = await runSubagent({
      task: "look",
      readOnly: true,
      tools: [{ name: "list_files" }],
      complete: async () => (turn++ === 0 ? callTool("list_files") : answer("found it")),
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0].name).toBe("list_files");
    expect(run.output).toBe("found it");
    // `steps` is the index of the turn the child stopped on: one tool turn, then the
    // answer. It is what the delegation cost, not a count of completed iterations.
    expect(run.steps).toBe(1);
  });

  it("reports a child that ran out of budget as truncated rather than as an answer", async () => {
    // Never stops calling tools — the budget is the only thing that ends it.
    const run = await runSubagent({
      task: "search forever",
      readOnly: true,
      tools: [{ name: "search_code" }],
      complete: async () => callTool("search_code"),
      dispatch: async () => ({ data: { ok: true, matches: [] } }),
      maxSteps: 3,
    });

    expect(run.truncated).toBe(true);
    expect(run.steps).toBe(3);
  });

  it("is not ok when the child stopped without producing anything", async () => {
    const run = await runSubagent({
      task: "say nothing",
      readOnly: true,
      tools: [],
      complete: async () => answer("   "),
      dispatch: async () => ({ data: {} }),
    });

    expect(run.ok).toBe(false);
    expect(run.output.trim()).toBe("");
  });

  it("caps the answer so a rambling child cannot spend the parent's context", async () => {
    const run = await runSubagent({
      task: "ramble",
      readOnly: true,
      tools: [],
      complete: async () => answer("x".repeat(SUBAGENT_OUTPUT_CHARS + 500)),
      dispatch: async () => ({ data: {} }),
    });

    expect(run.output).toHaveLength(SUBAGENT_OUTPUT_CHARS);
  });

  it("ends cancelled, not ok, when the parent's signal aborts", async () => {
    const controller = new AbortController();
    const run = await runSubagent({
      task: "work",
      readOnly: true,
      tools: [{ name: "read_file" }],
      complete: async () => {
        controller.abort();
        return callTool("read_file");
      },
      dispatch: async () => ({ data: {} }),
      signal: controller.signal,
    });

    expect(run.cancelled).toBe(true);
    expect(run.ok).toBe(false);
  });

  it("defaults to the shared budget so both surfaces delegate on the same terms", async () => {
    const complete = vi.fn(async () => callTool("read_file"));
    const run = await runSubagent({
      task: "loop",
      readOnly: true,
      tools: [{ name: "read_file" }],
      complete,
      dispatch: async () => ({ data: {} }),
    });

    expect(run.steps).toBe(SUBAGENT_MAX_STEPS);
  });
});
