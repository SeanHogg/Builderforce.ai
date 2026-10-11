import { describe, expect, it } from "vitest";
import { delegationRoleRefusal } from "./modelRoles.js";

/** The Developer-vs-QA filter every `spawn_agent { as_agent }` backing runs. */
describe("delegationRoleRefusal", () => {
  it("lets a developer take a code slice and a QA agent take a verify slice", () => {
    expect(delegationRoleRefusal({ name: "Ada", roleKeys: ["developer"] }, "code")).toBeNull();
    expect(delegationRoleRefusal({ name: "Quinn", roleKeys: ["qa-tester"] }, "verify")).toBeNull();
  });

  it("refuses a code slice for a non-developer, naming what it needs and what it holds", () => {
    const refusal = delegationRoleRefusal({ name: "Pam", roleKeys: ["product-manager"] }, "code");
    expect(refusal).toContain("needs a developer");
    expect(refusal).toContain("product-manager");
    expect(refusal).toContain("role=developer");
  });

  it("refuses a verify slice for a developer with no QA role", () => {
    expect(delegationRoleRefusal({ name: "Ada", roleKeys: ["developer"] }, "verify")).toContain("qa-tester");
  });

  it("leaves reading, planning and chat open to any teammate", () => {
    for (const role of ["explore", "plan", "chat", "utility"] as const) {
      expect(delegationRoleRefusal({ name: "Pam", roleKeys: ["product-manager"] }, role)).toBeNull();
    }
  });

  it("does not filter when the host cannot tell an agent's roles", () => {
    expect(delegationRoleRefusal({ name: "Ada" }, "code")).toBeNull();
  });
});
