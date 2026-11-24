import { describe, expect, it, vi } from "vitest";
import { PERSONA_OFF, type GateResult } from "@builderforce/agent-tools";
import { startPersonaRun, type PersonaRunDeps, type PersonaRunMessage } from "./personaRun";

const DIR = "/ws/.builderforce/methodology";
const labels = {
  gateBlocked: (result: GateResult) => `blocked:${result.role}:${result.missing.join(",")}:${Object.values(result.producers).join(",")}`,
  gatePassed: (next: string) => `passed:${next}`,
  unknownRole: (name: string) => `unknown:${name}`,
};

function deps(exists: (path: string) => boolean): PersonaRunDeps & { posted: PersonaRunMessage[]; invokeModel: ReturnType<typeof vi.fn> } {
  const posted: PersonaRunMessage[] = [];
  const invokeModel = vi.fn(async () => undefined);
  return { exists, invokeModel, post: (message) => posted.push(message), labels, posted };
}

describe("startPersonaRun", () => {
  it("blocks Engineer when the PRD is missing, posts the label and does not call the model", () => {
    const d = deps(() => false);
    const out = startPersonaRun("engineer", DIR, "build it", PERSONA_OFF, d);
    expect(out.started).toBe(false);
    expect(d.invokeModel).not.toHaveBeenCalled();
    expect(d.posted).toEqual([{ kind: "gate-blocked", role: "engineer", text: "blocked:engineer:prd,mockup:analyst,designer" }]);
    // A blocked check still updates the hints for every gated role.
    expect(out.state.hints.engineer).toEqual(["prd", "mockup"]);
    expect(out.state.hints.designer).toEqual(["prd"]);
  });

  it("offers Designer after Analyst with a structured send, and hands writeAllowed the role's scope", () => {
    const d = deps(() => true);
    const out = startPersonaRun("analyst", DIR, "describe the product", PERSONA_OFF, d);
    expect(out.started).toBe(true);
    expect(out.state).toMatchObject({ role: "analyst", lastRequest: "describe the product" });
    expect(d.posted).toEqual([
      { kind: "gate-passed", role: "designer", text: "passed:designer", send: { text: "describe the product", role: "designer" } },
    ]);
    expect(d.invokeModel).toHaveBeenCalledWith("describe the product", { roleName: "analyst", scope: [{ key: "methodology" }] });
  });

  it("refuses a role the registry does not hold", () => {
    const d = deps(() => true);
    const out = startPersonaRun("hacker", DIR, "x", PERSONA_OFF, d);
    expect(out).toEqual({ started: false, state: PERSONA_OFF });
    expect(d.posted).toEqual([{ kind: "error", text: "unknown:hacker" }]);
    expect(d.invokeModel).not.toHaveBeenCalled();
  });

  it("keeps the previous hints and posts the error when exists throws", () => {
    const d = deps(() => {
      throw new Error("EACCES");
    });
    const before = { role: "designer", lastRequest: "old", hints: { engineer: ["mockup" as const] } };
    const out = startPersonaRun("engineer", DIR, "build it", before, d);
    expect(out.started).toBe(false);
    expect(out.state.hints).toBe(before.hints);
    expect(d.posted).toEqual([{ kind: "error", text: "EACCES" }]);
  });
});
