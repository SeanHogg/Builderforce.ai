import { describe, it, expect } from "vitest";
import {
  DIM,
  compilePsychometricProfile,
  buildPsychometricBlock,
  mergeExecParams,
  raiseThinkLevel,
  type PsychometricProfile,
} from "./psychometrics.js";

const profile = (vector: Record<string, number>, extra?: Partial<PsychometricProfile>): PsychometricProfile => ({
  vector,
  ...extra,
});

describe("compilePsychometricProfile", () => {
  it("returns no directives or params for a fully neutral vector", () => {
    const { directives, params } = compilePsychometricProfile(profile({}));
    expect(directives).toEqual([]);
    expect(params).toEqual({});
  });

  it("high conscientiousness emits a planning directive and raises think depth", () => {
    const { directives, params } = compilePsychometricProfile(
      profile({ [DIM.conscientiousness]: 90 }),
    );
    expect(directives.some((d) => /plan before acting/i.test(d))).toBe(true);
    expect(params.thinkLevel).toBe("high");
  });

  it("high openness and risk tolerance raise temperature; low lowers it", () => {
    const hot = compilePsychometricProfile(
      profile({ [DIM.openness]: 90, [DIM.riskTolerance]: 90 }),
    );
    const cold = compilePsychometricProfile(
      profile({ [DIM.openness]: 10, [DIM.riskTolerance]: 10 }),
    );
    expect(hot.params.temperature).toBeGreaterThan(0.6);
    expect(cold.params.temperature).toBeLessThan(0.6);
  });

  it("high need-for-cognition turns reasoning on and deepens thinking", () => {
    const { params } = compilePsychometricProfile(
      profile({ [DIM.needForCognition]: 95 }),
    );
    expect(params.reasoningLevel).toBe("on");
    expect(params.thinkLevel).toBe("high");
  });

  it("never emits a dishonesty directive for low honesty, but does for high", () => {
    const low = compilePsychometricProfile(profile({ [DIM.honesty]: 5 }));
    expect(low.directives.join(" ")).not.toMatch(/fabricate|sycophan/i);
    const high = compilePsychometricProfile(profile({ [DIM.honesty]: 95 }));
    expect(high.directives.some((d) => /never fabricate/i.test(d))).toBe(true);
  });

  it("derives Thomas-Kilmann collaborating mode from both axes high", () => {
    const { directives } = compilePsychometricProfile(
      profile({ [DIM.conflictAssertiveness]: 90, [DIM.conflictCooperativeness]: 90 }),
    );
    expect(directives.some((d) => /collaborating/i.test(d))).toBe(true);
  });

  it("maps an Enneagram core type to a motivation directive", () => {
    const { directives } = compilePsychometricProfile(profile({}, { enneagramType: 5 }));
    expect(directives.some((d) => /understand deeply/i.test(d))).toBe(true);
  });

  it("is deterministic", () => {
    const v = { [DIM.openness]: 80, [DIM.conscientiousness]: 70 };
    expect(compilePsychometricProfile(profile(v))).toEqual(compilePsychometricProfile(profile(v)));
  });

  it("clamps out-of-range scores", () => {
    const { directives } = compilePsychometricProfile(profile({ [DIM.openness]: 999 }));
    expect(directives.some((d) => /explore novel/i.test(d))).toBe(true);
  });
});

describe("buildPsychometricBlock", () => {
  it("returns '' when undefined or neutral", () => {
    expect(buildPsychometricBlock(undefined)).toBe("");
    expect(buildPsychometricBlock(profile({}))).toBe("");
  });

  it("renders a bulleted personality block", () => {
    const block = buildPsychometricBlock(profile({ [DIM.conscientiousness]: 90 }));
    expect(block).toContain("Personality (execute under these traits):");
    expect(block).toMatch(/^- /m);
  });
});

describe("mergeExecParams", () => {
  it("takes the strongest think level and averages temperature", () => {
    const merged = mergeExecParams([
      profile({ [DIM.needForCognition]: 95, [DIM.openness]: 90 }), // think high, temp up
      profile({ [DIM.openness]: 10 }), // temp down
    ]);
    expect(merged.thinkLevel).toBe("high");
    expect(merged.reasoningLevel).toBe("on");
    expect(typeof merged.temperature).toBe("number");
  });

  it("returns empty for profiles with no signal", () => {
    expect(mergeExecParams([profile({})])).toEqual({});
  });
});

describe("raiseThinkLevel", () => {
  it("acts as a floor — never lowers the requested level", () => {
    expect(raiseThinkLevel("high", "low")).toBe("high");
    expect(raiseThinkLevel("low", "high")).toBe("high");
    expect(raiseThinkLevel(undefined, "medium")).toBe("medium");
    expect(raiseThinkLevel("medium", undefined)).toBe("medium");
  });
});
