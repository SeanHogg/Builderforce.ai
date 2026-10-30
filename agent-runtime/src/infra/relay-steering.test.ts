import { describe, expect, it, vi } from "vitest";
import { createSteeringChannel, normalizeSteeringText } from "./relay-steering.js";

describe("normalizeSteeringText", () => {
  it("trims usable text and rejects empty / whitespace-only / non-string", () => {
    expect(normalizeSteeringText("  do the thing  ")).toBe("do the thing");
    expect(normalizeSteeringText("")).toBeNull();
    expect(normalizeSteeringText("   ")).toBeNull();
    expect(normalizeSteeringText(undefined)).toBeNull();
    expect(normalizeSteeringText(123)).toBeNull();
  });
});

describe("createSteeringChannel", () => {
  it("ignores unusable text without queueing", () => {
    const ch = createSteeringChannel();
    expect(ch.push("   ")).toBe(false);
    expect(ch.push(undefined)).toBe(false);
    expect(ch.pending()).toBe(0);
  });

  it("drains the queued steers oldest first, once", () => {
    const ch = createSteeringChannel();
    expect(ch.push("  add tests  ")).toBe(true);
    expect(ch.push("then document it")).toBe(true);
    expect(ch.pending()).toBe(2);
    expect(ch.drain()).toEqual(["add tests", "then document it"]);
    expect(ch.pending()).toBe(0);
    expect(ch.drain()).toEqual([]);
  });

  it("refuses pushes once closed, and still hands back what was queued before the close", () => {
    const ch = createSteeringChannel();
    ch.push("queued before close", 7);
    ch.close();
    expect(ch.closed()).toBe(true);
    expect(ch.push("too late")).toBe(false);
    expect(ch.takeAll()).toEqual([{ text: "queued before close", messageId: 7 }]);
    expect(ch.takeAll()).toEqual([]);
  });

  it("tells a listener the moment a steer is queued, until it unsubscribes", () => {
    const ch = createSteeringChannel();
    const listener = vi.fn();
    const off = ch.onPush(listener);
    ch.push("first");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    ch.push("second");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a listener that throws neither fails the push, loses the steer, nor starves the listeners after it", () => {
    const ch = createSteeringChannel();
    const after = vi.fn();
    ch.onPush(() => {
      throw new Error("listener bug");
    });
    ch.onPush(after);
    expect(ch.push("still queued")).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
    expect(ch.drain()).toEqual(["still queued"]);
  });
});
