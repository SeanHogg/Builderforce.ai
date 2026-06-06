import { describe, it, expect } from "vitest";
import {
  awaitCodingSession,
  resolveCodingSession,
  hasPendingCodingSession,
} from "./coding-session-broker.js";

describe("coding-session-broker", () => {
  it("resolves a waiting session with the given outcome", async () => {
    const p = awaitCodingSession("s1", 5000);
    expect(hasPendingCodingSession("s1")).toBe(true);
    expect(resolveCodingSession("s1", { ok: true, text: "done" })).toBe(true);
    expect(await p).toEqual({ ok: true, text: "done" });
    expect(hasPendingCodingSession("s1")).toBe(false);
  });

  it("returns false when resolving an unknown session", () => {
    expect(resolveCodingSession("nope", { ok: false, text: "x" })).toBe(false);
  });

  it("resolves as a failure outcome on timeout", async () => {
    const outcome = await awaitCodingSession("s2", 10);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toMatch(/timed out/);
  });
});
