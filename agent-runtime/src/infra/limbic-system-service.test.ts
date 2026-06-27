import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

import { globalPersonaRegistry } from "../builderforce/personas.js";
import { DIM } from "../builderforce/psychometrics.js";
import { LIMBIC_DIM_NAMES, neutralState } from "../builderforce/limbic.js";
import {
  LimbicSystemService,
  hashedEmbedding,
  mapAgentEventToLimbic,
  projectEmbedding,
  resolveLimbicCheckpointPath,
} from "./limbic-system-service.js";
import { emitAgentEvent } from "./agent-events.js";

const PERSONA = "limbic-test-persona";

/** Register + activate a persona carrying a psychometric profile. */
function installPersona(vector: Record<string, number>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalPersonaRegistry.register({
    name: PERSONA,
    description: "test",
    capabilities: [],
    tools: [],
    persona: { voice: "", perspective: "", decisionStyle: "", psychometric: { vector } },
    source: "builderforce-assigned",
    active: true,
  } as any);
  globalPersonaRegistry.activate(PERSONA);
}

async function makeService(): Promise<LimbicSystemService> {
  // Huge trainEvery so the heuristic-or-model path never auto-trains / writes during tests.
  return LimbicSystemService.create({
    checkpointPath: path.join(os.tmpdir(), `limbic-test-${process.pid}.bin`),
    trainEvery: 1_000_000,
  });
}

afterEach(() => {
  globalPersonaRegistry.deactivate(PERSONA);
});

describe("checkpoint path + embedding helpers", () => {
  it("resolves the default checkpoint path", () => {
    expect(resolveLimbicCheckpointPath()).toMatch(/limbic\.bin$/);
    expect(resolveLimbicCheckpointPath("/x/y.bin")).toBe("/x/y.bin");
  });

  it("projectEmbedding pools/normalises to the target width", () => {
    const same = projectEmbedding(Float32Array.from([3, 4]), 2);
    expect(Math.hypot(same[0]!, same[1]!)).toBeCloseTo(1, 5);
    const pooled = projectEmbedding(Float32Array.from({ length: 256 }, (_, i) => i), 32);
    expect(pooled.length).toBe(32);
    let n = 0;
    for (const x of pooled) n += x * x;
    expect(Math.sqrt(n)).toBeCloseTo(1, 5);
    expect(projectEmbedding([], 8).every((x) => x === 0)).toBe(true);
  });

  it("hashedEmbedding is deterministic, unit-norm, and sized", () => {
    const a = hashedEmbedding("error: cannot read property", 32);
    const b = hashedEmbedding("error: cannot read property", 32);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(32);
    let norm = 0;
    for (const x of a) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
    // distinct text → distinct embedding
    expect(Array.from(hashedEmbedding("success", 32))).not.toEqual(Array.from(a));
  });
});

describe("personality coupling (setpoints)", () => {
  beforeEach(() => installPersona({ [DIM.openness]: 95, [DIM.riskTolerance]: 85 }));

  it("derives setpoints from the active persona's profile", async () => {
    const svc = await makeService();
    const sp = svc.currentSetpoints();
    expect(sp.driveCuriosity).toBeGreaterThan(neutralState().driveCuriosity);
    expect(sp.exploration).toBeGreaterThan(neutralState().exploration);
  });

  it("falls back to neutral setpoints when no persona is active", async () => {
    globalPersonaRegistry.deactivate(PERSONA);
    const svc = await makeService();
    expect(svc.currentSetpoints()).toEqual(neutralState());
  });
});

describe("full execution simulation (heuristic regions, no GPU required)", () => {
  beforeEach(() => installPersona({ [DIM.conscientiousness]: 80, [DIM.emotionality]: 70 }));

  it("appraises events and moves affect in the right direction", async () => {
    const svc = await makeService();
    const before = svc.snapshot();

    await svc.appraise({ kind: "error", intensity: 1, text: "TypeError: undefined is not a function" });
    const afterErr = svc.snapshot();
    expect(afterErr.valence).toBeLessThan(before.valence);
    expect(afterErr.arousal).toBeGreaterThan(before.arousal);
    expect(afterErr.driveCaution).toBeGreaterThan(before.driveCaution);

    await svc.appraise({ kind: "success", intensity: 1, text: "all tests pass" });
    expect(svc.snapshot().valence).toBeGreaterThan(afterErr.valence);
  });

  it("homeostasis (tick) relaxes a disturbed state back toward setpoints", async () => {
    const svc = await makeService();
    // Disturb hard with a run of failures.
    for (let i = 0; i < 4; i++) await svc.appraise({ kind: "error", intensity: 1 });
    const disturbed = svc.snapshot();
    const sp = svc.currentSetpoints();
    const distBefore = Math.abs(disturbed.valence - sp.valence);

    for (let i = 0; i < 50; i++) svc.tick();
    const settled = svc.snapshot();
    const distAfter = Math.abs(settled.valence - sp.valence);
    expect(distAfter).toBeLessThan(distBefore);
    for (const n of LIMBIC_DIM_NAMES) expect(settled[n]).toBeCloseTo(sp[n], 1);
  });

  it("the thalamic attention gate responds to arousal", async () => {
    const svc = await makeService();
    const calm = svc.attention();
    // Spike arousal via repeated risk/error events.
    for (let i = 0; i < 5; i++) await svc.appraise({ kind: "risk", intensity: 1 });
    // Attention is an inverted-U; either way it must stay a valid gate.
    const gate = svc.attention();
    expect(gate).toBeGreaterThanOrEqual(0.1);
    expect(gate).toBeLessThanOrEqual(1);
    expect(typeof calm).toBe("number");
  });

  it("basal-ganglia selection follows the live state", async () => {
    const svc = await makeService();
    svc.setState({ ...neutralState(), exploration: 1, driveCuriosity: 1, valence: 0.6 });
    expect(svc.select([{ novelty: 0.05, t: "safe" }, { novelty: 0.95, t: "novel" }]).choice?.t).toBe("novel");
    svc.setState({ ...neutralState(), exploration: 0.05, driveEffort: 0.1, driveCaution: 0.95 });
    expect(svc.select([{ novelty: 0.05, t: "safe" }, { novelty: 0.95, t: "novel" }]).choice?.t).toBe("safe");
  });

  it("compile() reflects the affective state in directives + exec params", async () => {
    const svc = await makeService();
    // A frustrated, stressed state.
    svc.setState({ ...neutralState(), valence: -0.7, arousal: 0.85, driveCaution: 0.9 });
    const { directives, params } = svc.compile();
    expect(directives.join(" ")).toMatch(/negative|caution|arousal/i);
    expect(["high", "xhigh"]).toContain(params.thinkLevel);
    expect(params.reasoningLevel).toBe("on");
  });

  it("maps raw agent-bus events to limbic events", () => {
    const base = { runId: "r1", seq: 1, ts: 0 };
    expect(mapAgentEventToLimbic({ ...base, stream: "tool", data: { phase: "result", name: "write", isError: true } })?.kind).toBe("error");
    expect(mapAgentEventToLimbic({ ...base, stream: "tool", data: { phase: "result", name: "read", isError: false } })?.kind).toBe("progress");
    expect(mapAgentEventToLimbic({ ...base, stream: "lifecycle", data: { phase: "error", error: "boom" } })?.kind).toBe("blocked");
    expect(mapAgentEventToLimbic({ ...base, stream: "lifecycle", data: { phase: "end" } })?.kind).toBe("success");
    expect(mapAgentEventToLimbic({ ...base, stream: "lifecycle", data: { phase: "start" } })).toBeNull();
    expect(mapAgentEventToLimbic({ ...base, stream: "tool", data: { phase: "update" } })).toBeNull();
  });

  it("persists and restores affect per session", async () => {
    const svc = await makeService();
    await svc.appraise({ kind: "error", intensity: 1 });
    const moody = svc.snapshot();
    expect(moody.valence).toBeLessThan(0);
    svc.saveSessionState("task:42");

    // Drift to a different state, then restore the session snapshot.
    svc.setState(neutralState());
    expect(svc.snapshot().valence).toBe(neutralState().valence);
    expect(svc.restoreSessionState("task:42")).toBe(true);
    expect(svc.snapshot().valence).toBeCloseTo(moody.valence, 6);
    // Unknown session → no-op.
    expect(svc.restoreSessionState("task:nope")).toBe(false);
  });

  it("appraises live from the agent event bus when attached", async () => {
    const svc = await makeService();
    const unsub = svc.attachToEventStream();
    const before = svc.snapshot().valence;
    emitAgentEvent({ runId: "rx", stream: "tool", data: { phase: "result", name: "build", isError: true } });
    // The handler appraises asynchronously (fire-and-forget) — flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.snapshot().valence).toBeLessThan(before);
    unsub();
  });

  it("simulates a full agent run: progress → error → recovery → success", async () => {
    const svc = await makeService();
    const trajectory: number[] = [svc.snapshot().valence];

    // Smooth early progress.
    await svc.appraise({ kind: "progress", intensity: 0.6 });
    svc.tick();
    trajectory.push(svc.snapshot().valence);

    // A blocking error mid-run — affect dips, caution + think rise.
    await svc.appraise({ kind: "error", intensity: 1, text: "build failed" });
    const stressed = svc.compile();
    expect(stressed.params.thinkLevel).toBeDefined();
    trajectory.push(svc.snapshot().valence);

    // Recovery: homeostasis + a fix landing.
    for (let i = 0; i < 8; i++) svc.tick();
    await svc.appraise({ kind: "success", intensity: 1, text: "fix verified, tests green" });
    trajectory.push(svc.snapshot().valence);

    // Dipped at the error, recovered by the success.
    expect(trajectory[2]!).toBeLessThan(trajectory[1]!);
    expect(trajectory[3]!).toBeGreaterThan(trajectory[2]!);

    // The service never throws and always exposes a coherent, bounded state.
    const s = svc.snapshot();
    for (const n of LIMBIC_DIM_NAMES) {
      expect(Number.isFinite(s[n])).toBe(true);
    }
  });
});
