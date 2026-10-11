import { describe, expect, it } from "vitest";
import { isMidTurnMetadata, MID_TURN_META_KEY } from "./turnPhase.js";

describe("isMidTurnMetadata", () => {
  it("reads the marker from the stored JSON string", () => {
    expect(isMidTurnMetadata(JSON.stringify({ [MID_TURN_META_KEY]: true, provenance: { model: "m" } }))).toBe(true);
  });

  it("reads the marker from a parsed object", () => {
    expect(isMidTurnMetadata({ [MID_TURN_META_KEY]: true })).toBe(true);
  });

  it("is false for a final answer's metadata", () => {
    expect(isMidTurnMetadata(JSON.stringify({ provenance: { model: "m" } }))).toBe(false);
  });

  it("is false for no metadata, a non-true marker, or unreadable JSON", () => {
    expect(isMidTurnMetadata(undefined)).toBe(false);
    expect(isMidTurnMetadata(null)).toBe(false);
    expect(isMidTurnMetadata(JSON.stringify({ [MID_TURN_META_KEY]: "yes" }))).toBe(false);
    expect(isMidTurnMetadata(`{"${MID_TURN_META_KEY}":true`)).toBe(false);
  });
});
