import { describe, expect, it } from "vitest";
import { looksLikeRunNarration, stripRunNarration } from "./runNarration.js";

// Verbatim from project #30's Evermind diagnostics (2026-10-11) — run text that
// self-learned into the head with no teacher pinned.
const OBSERVED = [
  "Now I need to modify the hook to accept a chatId parameter and add filtering logic. Let me update the imports first:",
  "First, I need to check if WorkDeltaService is already imported: Let me check if WorkDeltaService is already imported:",
  "Let me record the code change as a delta and then mark the ticket as done: Now let me record the code change as a delta:",
  "That was expected (TypeScript can't be directly executed). Let me check the VSCode webview for type errors:",
  "Let me check what's actually available for making API calls: I see `fetch` is not exported. Let me check what's available in vscodeBridge.ts for making API calls:",
];

describe("stripRunNarration", () => {
  it.each(OBSERVED)("strips observed mid-turn narration to nothing: %s", (text) => {
    expect(stripRunNarration(text).text).toBe("");
    expect(looksLikeRunNarration(text)).toBe(true);
  });

  it("keeps a real answer and drops only the narration around it", () => {
    const text =
      "Let me check the handler first.\n\nThe retry path now uses exponential backoff capped at 30 seconds, " +
      "and a non-retryable 4xx fails fast instead of looping.";
    const { text: kept, dropped } = stripRunNarration(text);
    expect(dropped).toBe(1);
    expect(kept).toBe(
      "The retry path now uses exponential backoff capped at 30 seconds, and a non-retryable 4xx fails fast instead of looping.",
    );
    expect(looksLikeRunNarration(text)).toBe(false);
  });

  it("never judges code, and keeps a lead-in that introduces it", () => {
    const text = "The fix:\n```ts\n// Let me be clear: this is code.\nconst x = 1;\n```\nLet me run the tests:";
    const { text: kept } = stripRunNarration(text);
    expect(kept).toBe("The fix:\n```ts\n// Let me be clear: this is code.\nconst x = 1;\n```");
  });

  it("preserves list structure and paragraph breaks in what it keeps", () => {
    const text = "Changes made\n- added the chatId filter\n- removed the unused fetch import\n\nNow let me verify the diff:";
    expect(stripRunNarration(text).text).toBe("Changes made\n- added the chatId filter\n- removed the unused fetch import");
  });

  it("drops self-referential process talk wherever it sits", () => {
    expect(stripRunNarration("Looking back at it: I ran git_status and three tool calls.").text).toBe("");
  });

  it("leaves plain factual prose untouched", () => {
    const text = "`fetch` is a browser global, so vscodeBridge does not export it. The hook filters pending changes by chat.";
    expect(stripRunNarration(text)).toEqual({ text, dropped: 0 });
    expect(looksLikeRunNarration(text)).toBe(false);
  });
});
