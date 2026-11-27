/**
 * The `builderforce_runAgent` tool over a stubbed turn: what it returns for the model, what it refuses to start, and how
 * it follows the invocation's cancellation. The turn itself is `builderforceTurn.ts` (its busy check: `chatRequestHandler.busy.test.ts`).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class LanguageModelTextPart {
    constructor(public value: string) {}
  }
  class LanguageModelToolResult {
    constructor(public content: unknown[]) {}
  }
  class CancellationError extends Error {}
  return {
    l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)])) },
    LanguageModelTextPart,
    LanguageModelToolResult,
    CancellationError,
    Disposable: class { constructor(public dispose: () => void) {} },
  };
});
vi.mock("../brain/brainRunHost", () => ({}));
vi.mock("./builderforceTurn", () => ({ createBuilderForceTurn: vi.fn() }));

import * as vscode from "vscode";
import { createRunAgentTool } from "./runAgentTool";
import type { TurnInput, TurnResult, TurnSink } from "./turnSink";

function token(cancelled = false) {
  return { isCancellationRequested: cancelled, onCancellationRequested: () => ({ dispose() {} }) } as never;
}

function run(input: unknown, turn: (input: TurnInput, sink: TurnSink) => Promise<TurnResult>, cancelled = false) {
  const runTurn = vi.fn(turn);
  const tool = createRunAgentTool(runTurn);
  const result = tool.invoke({ input } as never, token(cancelled)) as Promise<{ content: { value: string }[] }>;
  return { runTurn, result };
}

const textOf = (result: { content: { value: string }[] }) => result.content.map((part) => part.value).join("");

describe("the runAgent tool", () => {
  it("returns the buffered report with the chat id footer", async () => {
    const { result, runTurn } = run({ task: "fix it" }, async (_input, sink) => {
      sink.markdown("Done");
      sink.markdown(".");
      sink.progress("reading");
      return { brainChatId: 5 };
    });

    const text = textOf(await result);

    expect(text).toContain("Done.");
    expect(text).not.toContain("reading");
    expect(text).toContain("BuilderForce chat 5 — pass continueChatId: 5 to continue this conversation.");
    expect(runTurn.mock.calls[0][0]).toMatchObject({ prompt: "fix it", references: [] });
  });

  it("says so when the turn wrote nothing", async () => {
    const { result } = run({ task: "x" }, async () => ({}));

    expect(textOf(await result)).toBe("BuilderForce finished without a reply.");
  });

  it("turns a button into the command line", async () => {
    const { result } = run({ task: "x" }, async (_input, sink) => {
      sink.button({ command: "builderforce.signIn", title: "Sign in" });
      return {};
    });

    expect(textOf(await result)).toContain('Run the command "Sign in" (builderforce.signIn).');
  });

  it.each([undefined, {}, { task: "   " }, { task: null }])("starts no run for a missing or blank task (%j)", async (input) => {
    const { result, runTurn } = run(input, async () => ({}));

    expect(textOf(await result)).toBe("Give BuilderForce a task to work on.");
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("throws CancellationError when the invocation was cancelled", async () => {
    const { result } = run({ task: "x" }, async (input) => ({ brainChatId: input.signal.aborted ? 1 : 2 }), true);

    await expect(result).rejects.toBeInstanceOf(vscode.CancellationError);
  });

  it.each([1.5, "7", 0, -2, Number.NaN, 2 ** 60])("ignores a continueChatId that is not a positive safe integer (%s)", async (continueChatId) => {
    const { result, runTurn } = run({ task: "x", continueChatId }, async () => ({ brainChatId: 9 }));

    await result;

    expect(runTurn.mock.calls[0][0].priorChatId).toBeUndefined();
  });

  it("continues the chat a valid continueChatId names", async () => {
    const { result, runTurn } = run({ task: "x", continueChatId: 12 }, async () => ({ brainChatId: 12 }));

    await result;

    expect(runTurn.mock.calls[0][0].priorChatId).toBe(12);
  });
});
