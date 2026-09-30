import { describe, it, expect } from "vitest";
import { PSYCH_DIM } from "./psychometric-dims.js";
import { limbicTraits, mergeLimbicWithPsychometric } from "./psychometrics.js";
import { maxThink } from "./spec.js";

describe("limbicTraits (psychometric vocabulary → limbic traits)", () => {
  it("absent profile reads every trait as neutral", () => {
    expect(Object.values(limbicTraits(undefined)).every((v) => v === 50)).toBe(true);
  });

  it("projects the vector's dimension ids onto the named traits, clamped to 0..100", () => {
    const t = limbicTraits({
      vector: { [PSYCH_DIM.openness]: 95, [PSYCH_DIM.valStimulation]: 20, [PSYCH_DIM.riskTolerance]: 140 },
    });
    expect(t.openness).toBe(95);
    expect(t.stimulation).toBe(20);
    expect(t.riskTolerance).toBe(100);
    expect(t.grit).toBe(50);
  });
});

describe("mergeLimbicWithPsychometric (personality + dynamics)", () => {
  it("think level takes the deeper of the two", () => {
    const merged = mergeLimbicWithPsychometric({ thinkLevel: "medium" }, { thinkLevel: "high" });
    expect(merged.thinkLevel).toBe("high");
    expect(maxThink("low", "high")).toBe("high");
    expect(maxThink("xhigh", "medium")).toBe("xhigh");
  });

  it("reasoning turns on if either asks", () => {
    expect(mergeLimbicWithPsychometric({}, { reasoningLevel: "on" }).reasoningLevel).toBe("on");
    expect(mergeLimbicWithPsychometric({ reasoningLevel: "on" }, {}).reasoningLevel).toBe("on");
  });

  it("limbic temperature delta nudges the psychometric baseline and clamps", () => {
    const merged = mergeLimbicWithPsychometric({ temperature: 0.7 }, { temperatureDelta: 0.2 });
    expect(merged.temperature).toBeCloseTo(0.9, 6);
    const clampedHi = mergeLimbicWithPsychometric({ temperature: 0.95 }, { temperatureDelta: 0.3 });
    expect(clampedHi.temperature).toBe(1.0);
  });

  it("delta with no baseline uses 0.6 as the resting baseline", () => {
    const merged = mergeLimbicWithPsychometric({}, { temperatureDelta: -0.2 });
    expect(merged.temperature).toBeCloseTo(0.4, 6);
  });

  it("no limbic signal leaves psychometric params untouched", () => {
    expect(mergeLimbicWithPsychometric({ thinkLevel: "low" }, {})).toEqual({ thinkLevel: "low" });
  });
});
