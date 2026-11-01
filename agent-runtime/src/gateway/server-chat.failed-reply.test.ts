/**
 * A run that failed but said why as its reply streams that text to the chat, then ends in the error phase carrying the same text.
 * The error `final` ALWAYS carries `errorMessage` (the portal records it on the execution; every client shows it), and says
 * structurally, with `replyStreamed`, that the text was already streamed, for the clients that keep their stream on screen.
 */
import { describe, expect, it } from "vitest";
import { NOTICE, chatEventsFor } from "./chat-events.testkit.js";

const failedReply = [
  { stream: "assistant", data: { text: NOTICE } },
  { stream: "lifecycle", data: { phase: "error", error: NOTICE, runFailed: true } },
];

describe("the chat's view of a run that failed and said why as its reply", () => {
  it("streams the text, then ends in an error that STILL carries it, flagged as already streamed", () => {
    const events = chatEventsFor(failedReply);

    expect(events.map((e) => e.state)).toEqual(["delta", "error"]);
    expect(events[0]!.message?.content?.[0]?.text).toBe(NOTICE);
    expect(events[1]).toMatchObject({ state: "error", errorMessage: NOTICE, replyStreamed: true });
  });

  it("an error with nothing streamed before it carries its message and is not flagged", () => {
    const events = chatEventsFor([{ stream: "lifecycle", data: { phase: "error", error: "provider timeout" } }]);

    expect(events.map((e) => [e.state, e.errorMessage, e.replyStreamed])).toEqual([["error", "provider timeout", undefined]]);
  });

  it("an error whose message is not the reply keeps its message and is not flagged", () => {
    const events = chatEventsFor([
      { stream: "assistant", data: { text: "partial answer" } },
      { stream: "lifecycle", data: { phase: "error", error: "provider timeout" } },
    ]);

    expect(events.at(-1)).toMatchObject({ state: "error", errorMessage: "provider timeout" });
    expect(events.at(-1)!.replyStreamed).toBeUndefined();
  });
});
