import { describe, expect, it, vi } from "vitest";
import type { ModelTransport, RunOutcomeRow } from "@builderforce/agent-run";
import { createSteeringChannel } from "../infra/relay-steering.js";
import { acknowledgedSteering, observedModel, relayEventSink, type OnPremRunSinks } from "./onPremEvents.js";

const sinks = (): OnPremRunSinks => ({
  onAssistantText: vi.fn(),
  onToolUse: vi.fn(),
  onResult: vi.fn(),
  onSteerApplied: vi.fn(),
  onOutcome: vi.fn(),
});

const transport = (completion: Awaited<ReturnType<ModelTransport["complete"]>>): ModelTransport => ({ complete: async () => completion });

describe("observedModel", () => {
  it("reports an answer's text, each tool call with parsed arguments, and passes the completion through", async () => {
    const s = sinks();
    const completion = { content: "reading", toolCalls: [{ id: "c1", name: "read_file", arguments: '{"path":"a.ts"}' }] };
    const out = await observedModel(transport(completion), s).complete({ messages: [] });

    expect(out).toBe(completion);
    expect(s.onAssistantText).toHaveBeenCalledWith("reading");
    expect(s.onToolUse).toHaveBeenCalledWith("read_file", "c1", { path: "a.ts" });
    expect(s.onResult).not.toHaveBeenCalled();
  });

  it("reports a turn without tool calls as the run's answer so far, with its usage", async () => {
    const s = sinks();
    await observedModel(transport({ content: "done", usage: { inputTokens: 10, outputTokens: 2 } }), s).complete({ messages: [] });
    expect(s.onResult).toHaveBeenCalledWith(true, "done", { inputTokens: 10, outputTokens: 2 });
  });

  it("does not say a silent turn aloud, and keeps unparseable arguments visible", async () => {
    const s = sinks();
    await observedModel(transport({ content: "  ", toolCalls: [{ id: "c1", name: "run_command", arguments: "{oops" }] }), s).complete({ messages: [] });
    expect(s.onAssistantText).not.toHaveBeenCalled();
    expect(s.onToolUse).toHaveBeenCalledWith("run_command", "c1", expect.objectContaining({ raw: "{oops", parseError: expect.any(String) }));
  });

  it("keeps the transport's window and preflight ports", () => {
    const inner: ModelTransport = { complete: async () => ({ content: "" }), window: () => 1000, preflight: () => undefined };
    const observed = observedModel(inner, sinks());
    expect(observed.window?.("m")).toBe(1000);
    expect(observed.preflight).toBeDefined();
  });
});

describe("acknowledgedSteering", () => {
  it("hands the queue's steers to the run and remembers their texts, in order, for the acknowledgements", () => {
    const channel = createSteeringChannel();
    const { source, takeApplied } = acknowledgedSteering(channel);
    channel.push("first");
    channel.push("second");

    expect(source.drain()).toEqual(["first", "second"]);
    expect(takeApplied()).toBe("first");
    expect(takeApplied()).toBe("second");
    expect(takeApplied()).toBe("");
  });

  it("lets a steer cut the rest of the turn it lands in", () => {
    const channel = createSteeringChannel();
    const { source } = acknowledgedSteering(channel);
    const interrupted = vi.fn();
    const off = source.onInterrupt?.(interrupted);

    expect(source.hasInterrupt?.()).toBe(false);
    channel.push("stop that and do this");
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(source.hasInterrupt?.()).toBe(true);
    source.drain();
    expect(source.hasInterrupt?.()).toBe(false);
    off?.();
  });
});

describe("relayEventSink", () => {
  it("acknowledges a steer with the text the user sent, and only a steer", () => {
    const s = sinks();
    const sink = relayEventSink(s, () => "also add tests");
    sink.emit({ kind: "steer.applied", step: 1 });
    sink.emit({ kind: "turn.started", step: 1 });
    expect(s.onSteerApplied).toHaveBeenCalledTimes(1);
    expect(s.onSteerApplied).toHaveBeenCalledWith("also add tests");
  });

  it("hands the outcome row to the host", () => {
    const s = sinks();
    const row = { entryPoint: "on-prem" } as RunOutcomeRow;
    relayEventSink(s, () => "").outcome?.(row);
    expect(s.onOutcome).toHaveBeenCalledWith(row);
  });
});
