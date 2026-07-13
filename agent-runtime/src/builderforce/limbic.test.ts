import { describe, it, expect } from "vitest";
import { DIM, type PsychometricProfile } from "./psychometrics.js";
import {
  LIMBIC_DIM_NAMES,
  appraiseAmygdala,
  appraiseTask,
  applyDelta,
  arrayToState,
  basalGangliaExploreBias,
  basalGangliaSelect,
  buildLimbicBlock,
  clamp,
  compileLimbicState,
  deriveLimbicSetpoints,
  homeostasis,
  maxThink,
  mergeLimbicWithPsychometric,
  neutralState,
  stateToArray,
  thalamusGate,
  type LimbicState,
} from "./limbic.js";

const prof = (vector: Record<string, number>, extra?: Partial<PsychometricProfile>): PsychometricProfile => ({
  vector,
  ...extra,
});

describe("state vector plumbing", () => {
  it("neutral state is bounded and stable through array round-trip", () => {
    const s = neutralState();
    const round = arrayToState(stateToArray(s));
    for (const n of LIMBIC_DIM_NAMES) expect(round[n]).toBeCloseTo(s[n], 6);
  });

  it("clamp respects signed valence and [0,1] drives", () => {
    expect(clamp("valence", -3)).toBe(-1);
    expect(clamp("valence", 3)).toBe(1);
    expect(clamp("arousal", -1)).toBe(0);
    expect(clamp("driveEffort", 9)).toBe(1);
  });

  it("applyDelta clamps and ignores unknown/NaN entries", () => {
    const s = applyDelta(neutralState(), { valence: 5, arousal: -5, driveCuriosity: Number.NaN });
    expect(s.valence).toBe(1);
    expect(s.arousal).toBe(0);
    expect(s.driveCuriosity).toBe(neutralState().driveCuriosity);
  });
});

describe("deriveLimbicSetpoints (personality = setpoints)", () => {
  it("absent profile → neutral resting setpoints", () => {
    expect(deriveLimbicSetpoints(undefined)).toEqual(neutralState());
  });

  it("high openness rests more curious and exploratory", () => {
    const sp = deriveLimbicSetpoints(prof({ [DIM.openness]: 95, [DIM.riskTolerance]: 80 }));
    const base = neutralState();
    expect(sp.driveCuriosity).toBeGreaterThan(base.driveCuriosity);
    expect(sp.exploration).toBeGreaterThan(base.exploration);
  });

  it("conscientious + emotional + prevention rests more cautious", () => {
    const sp = deriveLimbicSetpoints(
      prof({ [DIM.conscientiousness]: 90, [DIM.emotionality]: 85, [DIM.regulatoryFocus]: 10, [DIM.riskTolerance]: 10 }),
    );
    expect(sp.driveCaution).toBeGreaterThan(neutralState().driveCaution);
  });

  it("extraversion raises the social setpoint; grit raises the effort setpoint", () => {
    const sp = deriveLimbicSetpoints(prof({ [DIM.extraversion]: 90, [DIM.grit]: 90 }));
    expect(sp.driveSocial).toBeGreaterThan(neutralState().driveSocial);
    expect(sp.driveEffort).toBeGreaterThanOrEqual(neutralState().driveEffort);
  });
});

describe("amygdala appraisal", () => {
  it("errors are negative, arousing, and raise caution", () => {
    const d = appraiseAmygdala({ kind: "error", intensity: 1 });
    expect(d.valence!).toBeLessThan(0);
    expect(d.arousal!).toBeGreaterThan(0);
    expect(d.driveCaution!).toBeGreaterThan(0);
  });

  it("success is positive and calming; intensity scales magnitude", () => {
    const strong = appraiseAmygdala({ kind: "success", intensity: 1 });
    const weak = appraiseAmygdala({ kind: "success", intensity: 0.2 });
    expect(strong.valence!).toBeGreaterThan(0);
    expect(strong.arousal!).toBeLessThan(0);
    expect(Math.abs(strong.valence!)).toBeGreaterThan(Math.abs(weak.valence!));
  });

  it("feedback sign flips valence", () => {
    expect(appraiseAmygdala({ kind: "feedback", sign: -1 }).valence!).toBeLessThan(0);
    expect(appraiseAmygdala({ kind: "feedback", sign: 1 }).valence!).toBeGreaterThan(0);
  });
});

describe("hypothalamus homeostasis", () => {
  it("relaxes the state toward setpoints", () => {
    const setpoints = neutralState();
    let s: LimbicState = applyDelta(neutralState(), { valence: -0.8, arousal: 0.7 });
    const before = Math.abs(s.valence - setpoints.valence);
    s = homeostasis(s, setpoints, { rate: 0.3 });
    const after = Math.abs(s.valence - setpoints.valence);
    expect(after).toBeLessThan(before);
  });

  it("converges to setpoints over many ticks", () => {
    const setpoints = deriveLimbicSetpoints(prof({ [DIM.openness]: 90 }));
    let s = applyDelta(neutralState(), { valence: -0.9, arousal: 0.9, driveEffort: -0.5 });
    for (let i = 0; i < 200; i++) s = homeostasis(s, setpoints, { rate: 0.2 });
    for (const n of LIMBIC_DIM_NAMES) expect(s[n]).toBeCloseTo(setpoints[n], 2);
  });

  it("fatigue drains effort", () => {
    const s = homeostasis(neutralState(), neutralState(), { rate: 0, fatigue: 0.2 });
    expect(s.driveEffort).toBeCloseTo(neutralState().driveEffort - 0.2, 5);
  });
});

describe("thalamus attention gate (Yerkes–Dodson)", () => {
  it("peaks at moderate arousal and degrades at the extremes", () => {
    const mid = thalamusGate({ ...neutralState(), arousal: 0.5 });
    const low = thalamusGate({ ...neutralState(), arousal: 0.0 });
    const high = thalamusGate({ ...neutralState(), arousal: 1.0 });
    expect(mid).toBeGreaterThan(low);
    expect(mid).toBeGreaterThan(high);
    expect(mid).toBeCloseTo(1, 5);
    expect(low).toBeGreaterThanOrEqual(0.1);
  });
});

describe("basal ganglia action selection", () => {
  it("high exploration + curiosity biases toward novelty", () => {
    const explorer = { ...neutralState(), exploration: 1, driveCuriosity: 1, valence: 0.5 };
    expect(basalGangliaExploreBias(explorer)).toBeGreaterThan(0.65);
  });

  it("low effort + caution biases toward exploit", () => {
    const tired = { ...neutralState(), exploration: 0.2, driveEffort: 0.1, driveCaution: 0.9 };
    expect(basalGangliaExploreBias(tired)).toBeLessThan(0.35);
  });

  it("select picks the candidate whose novelty matches the bias", () => {
    const explorer = { ...neutralState(), exploration: 1, driveCuriosity: 1, valence: 0.5 };
    const { choice } = basalGangliaSelect(explorer, [
      { novelty: 0.05, tag: "safe" },
      { novelty: 0.95, tag: "novel" },
    ]);
    expect(choice?.tag).toBe("novel");

    const tired = { ...neutralState(), exploration: 0.1, driveEffort: 0.1, driveCaution: 0.95 };
    const { choice: c2 } = basalGangliaSelect(tired, [
      { novelty: 0.05, tag: "safe" },
      { novelty: 0.95, tag: "novel" },
    ]);
    expect(c2?.tag).toBe("safe");
  });

  it("select returns null for empty options", () => {
    expect(basalGangliaSelect(neutralState(), []).choice).toBeNull();
  });
});

describe("compileLimbicState (dynamics → behaviour)", () => {
  it("a resting state produces no directives or params", () => {
    const { directives, params } = compileLimbicState(neutralState());
    expect(directives).toEqual([]);
    expect(params).toEqual({});
  });

  it("strong negative affect deepens thinking and turns reasoning on", () => {
    const { directives, params } = compileLimbicState({ ...neutralState(), valence: -0.7 });
    expect(directives.join(" ")).toMatch(/negative/i);
    expect(params.thinkLevel).toBe("high");
    expect(params.reasoningLevel).toBe("on");
  });

  it("high caution emits a guardrail directive and a think floor", () => {
    const { directives, params } = compileLimbicState({ ...neutralState(), driveCaution: 0.9 });
    expect(directives.join(" ")).toMatch(/caution/i);
    expect(["medium", "high", "xhigh"]).toContain(params.thinkLevel);
  });

  it("exploration raises temperature; caution lowers it", () => {
    const hot = compileLimbicState({ ...neutralState(), exploration: 1 });
    const cold = compileLimbicState({ ...neutralState(), driveCaution: 1, exploration: 0 });
    expect(hot.params.temperatureDelta!).toBeGreaterThan(0);
    expect(cold.params.temperatureDelta!).toBeLessThan(0);
  });

  it("is deterministic", () => {
    const s = { ...neutralState(), valence: -0.5, arousal: 0.8, driveCaution: 0.8 };
    expect(compileLimbicState(s)).toEqual(compileLimbicState(s));
  });

  it("buildLimbicBlock renders directives and is empty at rest", () => {
    expect(buildLimbicBlock(neutralState())).toBe("");
    expect(buildLimbicBlock({ ...neutralState(), valence: -0.8 })).toMatch(/affective state/i);
  });
});

describe("appraiseTask (initial affect from task text — cloud V3 / VS Code)", () => {
  it("risky/destructive work raises caution and arousal", () => {
    const s = appraiseTask("Delete the production database and wipe all rows");
    expect(s.driveCaution).toBeGreaterThan(neutralState().driveCaution);
    expect(s.arousal).toBeGreaterThan(neutralState().arousal);
    // and that compiles to a caution directive
    expect(compileLimbicState(s).directives.join(" ")).toMatch(/caution/i);
  });

  it("large/complex work raises curiosity and exploration", () => {
    const s = appraiseTask("Refactor the entire architecture across the whole codebase");
    expect(s.driveCuriosity).toBeGreaterThan(neutralState().driveCuriosity);
    expect(s.exploration).toBeGreaterThan(neutralState().exploration);
  });

  it("a mundane task stays at rest (no directives)", () => {
    const s = appraiseTask("Fix a typo in the README heading");
    expect(compileLimbicState(s).directives).toEqual([]);
  });

  it("is deterministic and respects an explicit base state", () => {
    expect(appraiseTask("delete prod")).toEqual(appraiseTask("delete prod"));
    const base = { ...neutralState(), valence: -0.5 };
    expect(appraiseTask("fix typo", base).valence).toBeCloseTo(-0.5, 6);
  });
});

describe("mergeLimbicWithPsychometric (personality + dynamics)", () => {
  it("think level takes the deeper of the two", () => {
    const merged = mergeLimbicWithPsychometric({ thinkLevel: "medium" }, { thinkLevel: "high" });
    expect(merged.thinkLevel).toBe("high");
    expect(maxThink("low", "high")).toBe("high");
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
