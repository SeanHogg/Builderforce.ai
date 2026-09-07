import { describe, expect, it } from "vitest";
import {
  buildSteeringMessage,
  createSteeringChannel,
  normalizeSteeringText,
} from "./relay-steering.js";

async function collect<T>(iterable: AsyncIterable<T>, max: number): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

describe("normalizeSteeringText", () => {
  it("trims usable text and rejects empty / whitespace-only / non-string", () => {
    expect(normalizeSteeringText("  do the thing  ")).toBe("do the thing");
    expect(normalizeSteeringText("")).toBeNull();
    expect(normalizeSteeringText("   ")).toBeNull();
    expect(normalizeSteeringText(undefined)).toBeNull();
    expect(normalizeSteeringText(123)).toBeNull();
  });
});

describe("buildSteeringMessage", () => {
  it("builds a top-level SDK user turn", () => {
    expect(buildSteeringMessage("tighten the error handling")).toEqual({
      type: "user",
      message: { role: "user", content: "tighten the error handling" },
      parent_tool_use_id: null,
    });
  });
});

describe("createSteeringChannel", () => {
  it("yields the task prompt first, then steers in push order, and ends on close", async () => {
    const ch = createSteeringChannel();
    const applied: string[] = [];
    const it = ch.messages("build the feature", (t) => applied.push(t))[Symbol.asyncIterator]();

    expect((await it.next()).value.message.content).toBe("build the feature");
    expect(applied).toEqual([]);

    expect(ch.push("  add tests  ")).toBe(true);
    expect(ch.push("then document it")).toBe(true);
    expect(ch.pending()).toBe(2);

    expect((await it.next()).value.message.content).toBe("add tests");
    expect((await it.next()).value.message.content).toBe("then document it");
    expect(applied).toEqual(["add tests", "then document it"]);
    expect(ch.pending()).toBe(0);

    ch.close();
    expect((await it.next()).done).toBe(true);
  });

  it("wakes a consumer waiting on an empty queue when a steer arrives", async () => {
    const ch = createSteeringChannel();
    const it = ch.messages("start")[Symbol.asyncIterator]();
    await it.next();

    const pending = it.next();
    ch.push("steer now");
    expect((await pending).value.message.content).toBe("steer now");
  });

  it("wakes a consumer waiting on an empty queue when the channel closes", async () => {
    const ch = createSteeringChannel();
    const it = ch.messages("start")[Symbol.asyncIterator]();
    await it.next();

    const pending = it.next();
    ch.close();
    expect((await pending).done).toBe(true);
  });

  it("refuses pushes after close and drains queued steers before ending", async () => {
    const ch = createSteeringChannel();
    ch.push("queued before close");
    ch.close();
    expect(ch.closed()).toBe(true);
    expect(ch.push("too late")).toBe(false);

    const msgs = await collect(ch.messages("start"), 10);
    expect(msgs.map((m) => m.message.content)).toEqual(["start", "queued before close"]);
  });

  it("ignores unusable text without queueing", () => {
    const ch = createSteeringChannel();
    expect(ch.push("   ")).toBe(false);
    expect(ch.push(undefined)).toBe(false);
    expect(ch.pending()).toBe(0);
  });
});
