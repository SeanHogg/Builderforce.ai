import { describe, expect, it } from "vitest";
import { buildPersonaSystemBlock, PersonaRegistry } from "./personas.js";
import { checkGate, loadChatPersona, producerOf, successorProducer } from "./methodologyGate.js";
import { METHODOLOGY_PERSONAS, registerMethodologyPersonas } from "./methodologyPersonas.js";
const DIR = "/ws/.builderforce/methodology";

describe("methodology gate", () => {
  it("blocks the Engineer when the PRD and mockup are absent, and names the producers", () => {
    const engineer = METHODOLOGY_PERSONAS.find((role) => role.name === "engineer")!;
    const result = checkGate(engineer, DIR, () => false);
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(["prd", "mockup"]);
    expect(result.producers.prd).toBe("analyst");
    expect(result.producers.mockup).toBe("designer");
  });

  it("passes the Analyst when nothing is required", () => {
    const analyst = METHODOLOGY_PERSONAS.find((role) => role.name === "analyst")!;
    expect(checkGate(analyst, DIR, () => false).passed).toBe(true);
  });

  it("lets an exists throw escape — that is an I/O failure, not a blocked gate", () => {
    const engineer = METHODOLOGY_PERSONAS.find((role) => role.name === "engineer")!;
    expect(() => checkGate(engineer, DIR, () => { throw new Error("disk"); })).toThrow("disk");
  });

  it("uses produces as the producer, in methodology order, not alphabetical order", () => {
    expect(producerOf("prd", METHODOLOGY_PERSONAS)).toBe("analyst");
    expect(producerOf("mockup", METHODOLOGY_PERSONAS)).toBe("designer");
    expect(producerOf("design", METHODOLOGY_PERSONAS)).toBe("designer");
    expect(producerOf("support", METHODOLOGY_PERSONAS)).toBe("support");
  });

  it("agrees with the successor rule for the PRD and the mockup", () => {
    expect(successorProducer("prd", METHODOLOGY_PERSONAS)).toBe(producerOf("prd", METHODOLOGY_PERSONAS));
    expect(successorProducer("mockup", METHODOLOGY_PERSONAS)).toBe(producerOf("mockup", METHODOLOGY_PERSONAS));
  });

  it("keeps methodology when the roles are registered by name", () => {
    const registry = new PersonaRegistry();
    registerMethodologyPersonas(registry);
    expect(registry.resolve("engineer")?.methodology?.route).toBe("pipeline");
    expect(registry.resolve("engineer")?.methodology?.recordsRun).toBe(true);
    const override = {
      ...METHODOLOGY_PERSONAS[0]!,
      source: "project-local" as const,
      methodology: undefined,
    };
    registry.register(override);
    expect(registry.resolve("analyst")?.methodology).toBeUndefined();
  });

  it("appends work after the Role line and still emits a block when that is all there is", () => {
    const analyst = METHODOLOGY_PERSONAS[0]!;
    const block = buildPersonaSystemBlock(analyst);
    expect(block).toContain("Role: analyst");
    const roleAt = block.indexOf("Role: analyst");
    const workAt = block.indexOf("Write methodology/prd.md");
    expect(workAt).toBeGreaterThan(roleAt);
  });

  it("loads a chat with no persona field as role off", () => {
    expect(loadChatPersona(undefined).role).toBeNull();
    expect(loadChatPersona({}).role).toBeNull();
  });
});
