import { describe, expect, it, vi } from "vitest";
import { startPersonaRun } from "./personaRun";

describe("startPersonaRun", () => {
  it("blocks Engineer when the PRD is missing and does not call the model", () => {
    const invokeModel = vi.fn();
    const posted: string[] = [];
    const started = startPersonaRun("engineer", "/ws/.builderforce/methodology", "build it", {
      exists: () => false,
      invokeModel,
      post: (message) => posted.push(message.text),
    });
    expect(started).toBe(false);
    expect(invokeModel).not.toHaveBeenCalled();
    expect(posted[0]).toContain("analyst");
    expect(posted[0]).toContain("prd");
  });

  it("offers Designer after Analyst and replays the request only through the model", () => {
    const invokeModel = vi.fn();
    const posted: Array<{ kind: string; role?: string; text: string }> = [];
    const started = startPersonaRun("analyst", "/ws/.builderforce/methodology", "describe the product", {
      exists: () => true,
      invokeModel,
      post: (message) => posted.push(message),
    });
    expect(started).toBe(true);
    expect(invokeModel).toHaveBeenCalledWith("describe the product");
    expect(posted.some((message) => message.kind === "gate-passed" && message.role === "designer")).toBe(true);
  });
});
