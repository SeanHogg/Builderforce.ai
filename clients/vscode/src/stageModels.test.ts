import { describe, expect, it } from "vitest";
import { ROLE_MODEL_DEFAULT_ENV, ROLE_MODELS_ENV } from "@builderforce/learned-routing";
import { editorRunSettingsFrom, runRequestFields, stageModels } from "./stageModels";
import { explicitRoleModelPin, modelForChildRun } from "./roleModelPin";

describe("stageModels", () => {
  it("takes the settings over the env pins, stage by stage", () => {
    expect(stageModels(
      { plan: "set-plan", review: " set-review " },
      { plan: "env-plan", code: "env-code", verify: "env-verify", subagent: "env-sub" },
    )).toEqual({ plan: "set-plan", code: "env-code", verify: "set-review", subagent: "env-sub" });
  });

  it("is empty when nothing is configured — the gateway orders by role", () => {
    expect(stageModels({ plan: "", code: "   " }, {})).toEqual({});
  });
});

describe("explicitRoleModelPin", () => {
  it("names a role only when ROLE_MODELS does — never the catch-all default", () => {
    const env = { [ROLE_MODELS_ENV]: '{"subagent":"cheap"}', [ROLE_MODEL_DEFAULT_ENV]: "catch-all" };
    expect(explicitRoleModelPin("subagent", env)).toBe("cheap");
    expect(explicitRoleModelPin("quick", env)).toBeUndefined();
    expect(explicitRoleModelPin("quick", { [ROLE_MODEL_DEFAULT_ENV]: "catch-all" })).toBeUndefined();
  });
});

describe("modelForChildRun with a sub-agent stage model", () => {
  it("the sub-agent model wins unless the owner's pick is strict", () => {
    expect(modelForChildRun({ model: "parent", subagentModel: "sub" }, "verify", {})).toBe("sub");
    expect(modelForChildRun({ model: "parent", modelStrict: true, subagentModel: "sub" }, "verify", {})).toBe("parent");
  });
});

describe("editorRunSettingsFrom", () => {
  it("maps stages to phase models, routing, the cap and the sub-agent model", () => {
    expect(editorRunSettingsFrom(
      { plan: "p", code: "c", verify: "v", subagent: "s", quick: "q" },
      { routing: "always", routeThreshold: 0.65, maxRunBudgetUsd: 2.5 },
    )).toEqual({
      phaseModels: { plan: "p", code: "c", verify: "v" },
      pipeline: { routing: "always", threshold: 0.65, quickModel: "q" },
      maxRunBudgetUsd: 2.5,
      subagentModel: "s",
    });
  });

  it("defaults to auto routing, no cap and no phase models", () => {
    expect(editorRunSettingsFrom({}, { routing: "weird", routeThreshold: "x", maxRunBudgetUsd: 0 })).toEqual({ pipeline: { routing: "auto" } });
    expect(editorRunSettingsFrom({}, { routeThreshold: 7 }).pipeline?.threshold).toBe(1);
  });
});

describe("runRequestFields", () => {
  const settings = editorRunSettingsFrom({ code: "c" }, { maxRunBudgetUsd: 1 });
  it("a top-level run gets everything", () => {
    expect(runRequestFields(settings, { child: false })).toEqual({ phaseModels: { code: "c" }, pipeline: { routing: "auto" }, maxRunBudgetUsd: 1 });
  });
  it("a sub-agent gets only the cap", () => {
    expect(runRequestFields(settings, { child: true })).toEqual({ maxRunBudgetUsd: 1 });
    expect(runRequestFields(undefined, { child: false })).toEqual({});
  });
});
