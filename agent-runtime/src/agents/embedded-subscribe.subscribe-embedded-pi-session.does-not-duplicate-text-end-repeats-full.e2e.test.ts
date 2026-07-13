import { describe, expect, it, vi } from "vitest";
import { createStubSessionHarness } from "./embedded-subscribe.e2e-harness.js";
import { subscribeEmbeddedSession } from "./embedded-subscribe.js";

describe("subscribeEmbeddedSession", () => {
  function createTextEndHarness(chunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "newline";
  }) {
    const { session, emit } = createStubSessionHarness();
    const onBlockReply = vi.fn();

    const subscription = subscribeEmbeddedSession({
      session,
      runId: "run",
      onBlockReply,
      blockReplyBreak: "text_end",
      blockReplyChunking: chunking,
    });

    return { emit, onBlockReply, subscription };
  }

  it("does not duplicate when text_end repeats full content", () => {
    const { emit, onBlockReply, subscription } = createTextEndHarness();

    emit({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Good morning!",
      },
    });

    emit({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_end",
        content: "Good morning!",
      },
    });

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(subscription.assistantTexts).toEqual(["Good morning!"]);
  });
  it("does not duplicate block chunks when text_end repeats full content", () => {
    const { emit, onBlockReply } = createTextEndHarness({
      minChars: 5,
      maxChars: 40,
      breakPreference: "newline",
    });

    const fullText = "First line\nSecond line\nThird line\n";

    emit({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_delta",
        delta: fullText,
      },
    });

    const callsAfterDelta = onBlockReply.mock.calls.length;
    expect(callsAfterDelta).toBeGreaterThan(0);

    emit({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_end",
        content: fullText,
      },
    });

    expect(onBlockReply).toHaveBeenCalledTimes(callsAfterDelta);
  });
});
