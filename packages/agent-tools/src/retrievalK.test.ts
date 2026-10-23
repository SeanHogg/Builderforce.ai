import { describe, expect, it } from "vitest";
import { chooseK, hasClearHead } from "./retrievalK.js";

describe("chooseK", () => {
  it("starts at 3 when the head is clear", () => {
    expect(chooseK({ requested: 6, scores: [0.95, 0.9, 0.85, 0.4, 0.3, 0.2] })).toBe(3);
  });

  it("widens to the requested K when the best score is below the floor", () => {
    expect(chooseK({ requested: 6, scores: [0.4, 0.3, 0.3, 0.2, 0.2, 0.1] })).toBe(6);
  });

  it("widens when the cut would land on a plateau", () => {
    // Lexical-only recall scores every hit the same — no evidence to cut on.
    expect(chooseK({ requested: 5, scores: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9] })).toBe(5);
  });

  it("never exceeds requested, max or the candidates there are", () => {
    expect(chooseK({ requested: 20, max: 8, scores: Array(30).fill(0.1) })).toBe(8);
    expect(chooseK({ requested: 6, scores: [0.2, 0.1] })).toBe(2);
    expect(chooseK({ requested: 2, scores: [0.95, 0.2, 0.1] })).toBe(2);
    expect(chooseK({ requested: 6, scores: [] })).toBe(0);
  });

  it("caps by the token budget but always keeps the best candidate", () => {
    expect(chooseK({ requested: 6, scores: Array(6).fill(0.1), budgetTokens: 250, itemTokens: [100, 100, 100, 100, 100, 100] })).toBe(2);
    expect(chooseK({ requested: 6, scores: Array(6).fill(0.1), budgetTokens: 10, itemTokens: [100, 100, 100, 100, 100, 100] })).toBe(1);
  });

  it("treats a field no larger than the start as a clear head", () => {
    expect(hasClearHead([0.9, 0.8])).toBe(true);
    expect(hasClearHead([Number.NaN])).toBe(false);
  });
});
