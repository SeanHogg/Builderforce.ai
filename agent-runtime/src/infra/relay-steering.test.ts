import { describe, expect, it } from "vitest";
import { buildSteeringInjection } from "./relay-steering.js";

describe("buildSteeringInjection", () => {
  it("builds a chat.send against the main session with a unique idempotency key", () => {
    const out = buildSteeringInjection(42, "tighten the error handling", 1000);
    expect(out).toEqual({
      sessionKey: "main",
      message: "tighten the error handling",
      idempotencyKey: "steer-42-1000",
    });
  });

  it("trims surrounding whitespace from the message", () => {
    const out = buildSteeringInjection(7, "  do the thing  ", 5);
    expect(out?.message).toBe("do the thing");
  });

  it("falls back to 'na' in the key when executionId is undefined", () => {
    const out = buildSteeringInjection(undefined, "hello", 9);
    expect(out?.idempotencyKey).toBe("steer-na-9");
  });

  it("returns null for empty / whitespace-only / non-string text", () => {
    expect(buildSteeringInjection(1, "", 1)).toBeNull();
    expect(buildSteeringInjection(1, "   ", 1)).toBeNull();
    expect(buildSteeringInjection(1, undefined, 1)).toBeNull();
    expect(buildSteeringInjection(1, 123, 1)).toBeNull();
  });

  it("keeps the idempotency key distinct across two sends of identical text", () => {
    const a = buildSteeringInjection(3, "again", 100);
    const b = buildSteeringInjection(3, "again", 101);
    expect(a?.idempotencyKey).not.toBe(b?.idempotencyKey);
  });
});
