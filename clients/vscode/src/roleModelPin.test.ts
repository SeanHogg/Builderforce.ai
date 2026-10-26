import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_MODEL_DEFAULT_ENV, ROLE_MODELS_ENV } from "@builderforce/learned-routing";
import { modelForChildRun, NATIVE_RUN_ROLE, roleModelPin } from "./roleModelPin";

const SRC = __dirname;

const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  [ROLE_MODELS_ENV]: '{"code":"claude-opus-4-8","verify":"gpt-4.1-mini"}',
  [ROLE_MODEL_DEFAULT_ENV]: "claude-sonnet-4-6",
  ...over,
});

describe("roleModelPin", () => {
  it("maps a role from ROLE_MODELS JSON", () => {
    expect(roleModelPin("code", env())).toBe("claude-opus-4-8");
    expect(roleModelPin("verify", env())).toBe("gpt-4.1-mini");
    expect(roleModelPin(NATIVE_RUN_ROLE, env())).toBe("claude-opus-4-8");
  });

  it("falls through to ROLE_MODEL_DEFAULT for an unmapped role", () => {
    expect(roleModelPin("plan", env())).toBe("claude-sonnet-4-6");
    expect(roleModelPin("explore", env())).toBe("claude-sonnet-4-6");
  });

  it("is undefined when the operator has not pinned anything", () => {
    expect(roleModelPin("code", {})).toBeUndefined();
    expect(roleModelPin("code", { [ROLE_MODELS_ENV]: "" })).toBeUndefined();
    expect(roleModelPin("code", { [ROLE_MODELS_ENV]: "not-json" })).toBeUndefined();
  });

  it("accepts an already-parsed ROLE_MODELS object", () => {
    const bag = { [ROLE_MODELS_ENV]: { developer: "claude-opus-4-8" } } as unknown as NodeJS.ProcessEnv;
    expect(roleModelPin("developer", bag)).toBe("claude-opus-4-8");
  });
});

describe("modelForChildRun", () => {
  it("keeps an explicit parent pick even when the child's role is mapped", () => {
    expect(
      modelForChildRun({ model: "user-opus", modelStrict: true }, "verify", env()),
    ).toBe("user-opus");
  });

  it("pins the child's role when the parent pick is not strict", () => {
    expect(modelForChildRun({ model: "parent-sonnet" }, "verify", env())).toBe("gpt-4.1-mini");
    expect(modelForChildRun({ model: "parent-sonnet", modelStrict: false }, "code", env())).toBe(
      "claude-opus-4-8",
    );
  });

  it("inherits the parent model when the role has no pin", () => {
    expect(modelForChildRun({ model: "parent-sonnet" }, "code", {})).toBe("parent-sonnet");
    expect(modelForChildRun({ model: "parent-sonnet" }, "plan", { [ROLE_MODELS_ENV]: '{"code":"opus"}' })).toBe(
      "parent-sonnet",
    );
  });

  it("leaves a checking or reading child to the gateway's cheaper tier instead of the coder's model", () => {
    for (const role of ["verify", "explore", "utility"]) {
      expect(modelForChildRun({ model: "parent-opus" }, role, {})).toBeUndefined();
    }
  });

  it("leaves the child unpinned when neither side has a model", () => {
    expect(modelForChildRun({}, "verify", {})).toBeUndefined();
  });
});

describe("native Brain run wiring", () => {
  it("applies the coding-role pin in model policy, and per-role overlay at child spawn", () => {
    const modelState = fs.readFileSync(path.join(SRC, "modelState.ts"), "utf8");
    expect(modelState).toContain("roleModelPin(NATIVE_RUN_ROLE)");
    const child = fs.readFileSync(path.join(SRC, "childRunHost.ts"), "utf8");
    expect(child).toContain("modelForChildRun(parent, req.role)");
  });
});
