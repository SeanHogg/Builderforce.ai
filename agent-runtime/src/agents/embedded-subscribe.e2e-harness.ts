import type { AssistantMessage } from "../builderforce/model/types.js";
import { expect } from "vitest";
import { subscribeEmbeddedSession } from "./embedded-subscribe.js";

type SubscribeEmbeddedSession = typeof subscribeEmbeddedSession;
type SubscribeEmbeddedSessionParams = Parameters<SubscribeEmbeddedSession>[0];
type HarnessSession = Parameters<SubscribeEmbeddedSession>[0]["session"];
type OnBlockReply = NonNullable<SubscribeEmbeddedSessionParams["onBlockReply"]>;

export function createStubSessionHarness(): {
  session: HarnessSession;
  emit: (evt: unknown) => void;
} {
  let handler: ((evt: unknown) => void) | undefined;
  const session = {
    subscribe: (fn: (evt: unknown) => void) => {
      handler = fn;
      return () => {};
    },
  } as unknown as HarnessSession;

  return { session, emit: (evt: unknown) => handler?.(evt) };
}

export function createSubscribedSessionHarness(
  params: Omit<Parameters<SubscribeEmbeddedSession>[0], "session"> & {
    sessionExtras?: Partial<HarnessSession>;
  },
): {
  emit: (evt: unknown) => void;
  session: HarnessSession;
  subscription: ReturnType<SubscribeEmbeddedSession>;
} {
  const { sessionExtras, ...subscribeParams } = params;
  const { session, emit } = createStubSessionHarness();
  const mergedSession = Object.assign(session, sessionExtras ?? {});
  const subscription = subscribeEmbeddedSession({
    ...subscribeParams,
    session: mergedSession,
  });
  return { emit, session: mergedSession, subscription };
}

export function createParagraphChunkedBlockReplyHarness(params: {
  chunking: { minChars: number; maxChars: number };
  onBlockReply?: OnBlockReply;
  runId?: string;
}): {
  emit: (evt: unknown) => void;
  onBlockReply: OnBlockReply;
  subscription: ReturnType<SubscribeEmbeddedSession>;
} {
  const onBlockReply: OnBlockReply = params.onBlockReply ?? (() => {});
  const { emit, subscription } = createSubscribedSessionHarness({
    runId: params.runId ?? "run",
    onBlockReply,
    blockReplyBreak: "message_end",
    blockReplyChunking: {
      ...params.chunking,
      breakPreference: "paragraph",
    },
  });
  return { emit, onBlockReply, subscription };
}

export function extractAgentEventPayloads(calls: Array<unknown[]>): Array<Record<string, unknown>> {
  return calls
    .map((call) => {
      const first = call?.[0] as { data?: unknown } | undefined;
      const data = first?.data;
      return data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
    })
    .filter((value): value is Record<string, unknown> => Boolean(value));
}

export function extractTextPayloads(calls: Array<unknown[]>): string[] {
  return calls
    .map((call) => {
      const payload = call?.[0] as { text?: unknown } | undefined;
      return typeof payload?.text === "string" ? payload.text : undefined;
    })
    .filter((text): text is string => Boolean(text));
}

export function emitMessageStartAndEndForAssistantText(params: {
  emit: (evt: unknown) => void;
  text: string;
}): void {
  const assistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: params.text }],
  } as AssistantMessage;
  params.emit({ type: "message_start", message: assistantMessage });
  params.emit({ type: "message_end", message: assistantMessage });
}

export function emitAssistantTextDeltaAndEnd(params: {
  emit: (evt: unknown) => void;
  text: string;
}): void {
  params.emit({
    type: "message_update",
    message: { role: "assistant" },
    assistantMessageEvent: {
      type: "text_delta",
      delta: params.text,
    },
  });
  const assistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: params.text }],
  } as AssistantMessage;
  params.emit({ type: "message_end", message: assistantMessage });
}

export function expectFencedChunks(calls: Array<unknown[]>, expectedPrefix: string): void {
  expect(calls.length).toBeGreaterThan(1);
  for (const call of calls) {
    const chunk = (call[0] as { text?: unknown } | undefined)?.text;
    expect(typeof chunk === "string" && chunk.startsWith(expectedPrefix)).toBe(true);
    const fenceCount = typeof chunk === "string" ? (chunk.match(/```/g)?.length ?? 0) : 0;
    expect(fenceCount).toBeGreaterThanOrEqual(2);
  }
}

export function expectSingleAgentEventText(calls: Array<unknown[]>, text: string): void {
  const payloads = extractAgentEventPayloads(calls);
  expect(payloads).toHaveLength(1);
  expect(payloads[0]?.text).toBe(text);
  expect(payloads[0]?.delta).toBe(text);
}
