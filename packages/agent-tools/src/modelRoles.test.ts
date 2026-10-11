import { describe, expect, it } from "vitest";
import { staffDelegation } from "./modelRoles.js";

describe("staffDelegation", () => {
  it("runs the slice as the named agent when it holds the delivery role", () => {
    expect(staffDelegation({ name: "Ada", roleKeys: ["developer"] }, "code")).toEqual({ kind: "as-agent" });
    expect(staffDelegation({ name: "Quinn", roleKeys: ["qa-tester"] }, "verify")).toEqual({ kind: "as-agent" });
  });

  it("runs a mismatched slice as an on-demand role persona instead of refusing it", () => {
    // Chat #134: "John Coder" held no developer key, the fan-out was refused, nothing ran.
    const s = staffDelegation({ name: "John Coder", roleKeys: [] }, "code");
    expect(s.kind).toBe("on-demand");
    if (s.kind !== "on-demand") return;
    expect(s.persona.name).toBe("Developer");
    expect(s.note).toContain("not attributed to John Coder");
    expect(s.note).toContain("builtin_cloud_agents_create");
    const qa = staffDelegation({ name: "Ada", roleKeys: ["developer"] }, "verify");
    expect(qa.kind === "on-demand" && qa.persona.name).toBe("QA Tester");
  });

  it("leaves open slices (explore, plan, chat) to any teammate", () => {
    for (const role of ["explore", "plan", "chat"] as const) {
      expect(staffDelegation({ name: "Pam", roleKeys: ["product-manager"] }, role)).toEqual({ kind: "as-agent" });
    }
  });

  it("does not filter when the host cannot tell the agent's roles", () => {
    expect(staffDelegation({ name: "Ada" }, "code")).toEqual({ kind: "as-agent" });
  });
});
