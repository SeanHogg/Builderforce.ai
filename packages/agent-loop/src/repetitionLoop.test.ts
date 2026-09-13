import { describe, it, expect, vi } from "vitest";
import { detectRepetitionLoop, trimRepetitionLoop } from "./repetitionLoop.js";
import { runAgentLoop } from "./loop.js";

// The sentence chat #105 repeated until the user pressed Stop.
const LOOPED = "I'll start by checking this chat's linked tickets and locating the Room bubble plus Brain Chat scroll code. ";

describe("detectRepetitionLoop", () => {
  it("catches a sentence written back to back and keeps everything before the loop plus one copy", () => {
    const intro = "I have both files. Next:\n";
    const loop = detectRepetitionLoop(intro + LOOPED.repeat(4));
    expect(loop).not.toBeNull();
    expect(loop!.block).toBe(LOOPED);
    expect(loop!.copies).toBe(4);
    expect(loop!.kept).toBe(intro + LOOPED);
  });

  it("catches the loop wherever in the block the text currently stops", () => {
    const loop = detectRepetitionLoop(LOOPED.repeat(3) + LOOPED.slice(0, 30));
    expect(loop).not.toBeNull();
    expect(loop!.kept).toBe(LOOPED);
  });

  it("lets a sentence said twice through — that is emphasis, not a loop", () => {
    expect(detectRepetitionLoop(LOOPED.repeat(2))).toBeNull();
  });

  it("ignores a repeated divider, which has no words in it", () => {
    expect(detectRepetitionLoop("─".repeat(400))).toBeNull();
  });

  it("never judges code inside an open fence", () => {
    const line = "  expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();\n";
    expect(detectRepetitionLoop("Here are the assertions:\n```ts\n" + line.repeat(4))).toBeNull();
  });

  it("still catches a loop that starts after a closed code fence", () => {
    expect(detectRepetitionLoop("```ts\nconst a = 1;\n```\n" + LOOPED.repeat(3))).not.toBeNull();
  });

  it("lets a list of similar but different items through", () => {
    const list = Array.from({ length: 12 }, (_, i) => `- Step ${i + 1}: read the file and record what it says about the room.\n`).join("");
    expect(detectRepetitionLoop(list)).toBeNull();
  });

  it("trimRepetitionLoop cuts a loop and leaves healthy text alone", () => {
    expect(trimRepetitionLoop("Done.\n" + LOOPED.repeat(5))).toBe("Done.\n" + LOOPED);
    expect(trimRepetitionLoop("A normal answer.")).toBe("A normal answer.");
  });
});

describe("runAgentLoop — a turn that arrives looped", () => {
  it("keeps only what the model said before the loop, and tells the surface", async () => {
    const intro = "Here is what I found:\n";
    const onRepetitionLoop = vi.fn();
    const result = await runAgentLoop<unknown>({
      messages: [],
      codec: { assistant: (turn) => turn, tool: (_call, res) => res },
      ports: {
        complete: async () => ({ content: intro + LOOPED.repeat(6), toolCalls: [] }),
        dispatch: async () => ({ data: null }),
      },
      hooks: { onRepetitionLoop },
      budget: {},
    });
    expect(result.output).toBe(intro + LOOPED);
    expect(onRepetitionLoop).toHaveBeenCalledTimes(1);
    expect(onRepetitionLoop.mock.calls[0]![1]).toMatchObject({ block: LOOPED, copies: 6 });
  });

  it("hands a no-tool-calls hook the trimmed turn, never the repeats", async () => {
    const seen: string[] = [];
    await runAgentLoop<unknown>({
      messages: [],
      codec: { assistant: (turn) => turn, tool: (_call, res) => res },
      ports: {
        complete: async () => ({ content: LOOPED.repeat(4), toolCalls: [] }),
        dispatch: async () => ({ data: null }),
      },
      hooks: { onNoToolCalls: (_ctx, turn) => { seen.push(turn.content); return { action: "finish" }; } },
      budget: {},
    });
    expect(seen).toEqual([LOOPED]);
  });
});
