/**
 * `update_prd` — the run's write-back to the ticket's shared spec.
 *
 * The tool is one name with a MODE, so the risk it carries is that the mode routes to
 * the wrong capability verb: `append` is additive and safe, `editSection` replaces a
 * section's whole body. Sending an "append" note down the section verb would silently
 * destroy a requirement. These pin the routing, the guards that stop a destructive call
 * from proceeding on incomplete arguments, and the capability gating that keeps the tool
 * off a surface that cannot back it.
 */
import { describe, expect, it, vi } from "vitest";
import type { Capability, CapabilityProvider, PrdUpdateResult } from "./capabilities.js";
import { buildCoreToolRegistry, updatePrdTool } from "./core-tools.js";
import type { ToolContext } from "./tool.js";

const append = vi.fn(async (): Promise<PrdUpdateResult> => ({ ok: true, mode: "append" }));
const editSection = vi.fn(async (): Promise<PrdUpdateResult> => ({ ok: true, mode: "section" }));

function providerWith(caps: readonly Capability[]): CapabilityProvider {
  return { capabilities: new Set<Capability>(caps), prd: { append, editSection } };
}
const ctx = (caps: readonly Capability[] = ["prd.write"]): ToolContext => ({ caps: providerWith(caps) });

describe("update_prd · mode routing", () => {
  it('mode "append" reaches append() and never the destructive verb', async () => {
    append.mockClear(); editSection.mockClear();
    const r = await updatePrdTool.execute({ mode: "append", content: "  Decided to use JWTs.  " }, ctx());
    expect(append).toHaveBeenCalledWith("Decided to use JWTs.");
    expect(editSection).not.toHaveBeenCalled();
    expect(r.data.ok).toBe(true);
  });

  it('mode "section" passes (heading, body) in that order', async () => {
    append.mockClear(); editSection.mockClear();
    await updatePrdTool.execute({ mode: "section", section: " Acceptance criteria ", content: "1. It works." }, ctx());
    expect(editSection).toHaveBeenCalledWith("Acceptance criteria", "1. It works.");
    expect(append).not.toHaveBeenCalled();
  });

  it("an unknown mode degrades to APPEND — the additive verb, never the destructive one", async () => {
    // A model that invents a mode must not have it resolved to a section rewrite.
    append.mockClear(); editSection.mockClear();
    await updatePrdTool.execute({ mode: "replace_everything", content: "note" }, ctx());
    expect(append).toHaveBeenCalledOnce();
    expect(editSection).not.toHaveBeenCalled();
  });

  it('mode "section" with no heading refuses WITHOUT calling the capability', async () => {
    append.mockClear(); editSection.mockClear();
    const r = await updatePrdTool.execute({ mode: "section", content: "1. It works." }, ctx());
    expect(r.data.ok).toBe(false);
    expect(editSection).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("empty content refuses before touching the PRD, in either mode", async () => {
    append.mockClear(); editSection.mockClear();
    for (const mode of ["append", "section"]) {
      const r = await updatePrdTool.execute({ mode, section: "Design", content: "   " }, ctx());
      expect(r.data.ok).toBe(false);
    }
    expect(append).not.toHaveBeenCalled();
    expect(editSection).not.toHaveBeenCalled();
  });
});

describe("update_prd · capability gating", () => {
  const registry = buildCoreToolRegistry();

  it("is offered only to a surface that advertises prd.write", () => {
    const offered = (caps: readonly Capability[]) =>
      registry.schemasForCapabilities(new Set<Capability>(caps)).map((s) => s.function.name);
    expect(offered(["prd.write"])).toContain("update_prd");
    expect(offered(["repo.read", "repo.write", "memory"])).not.toContain("update_prd");
  });

  it("declares prd.write and nothing else — it is not a repo write", () => {
    expect([...updatePrdTool.requires]).toEqual(["prd.write"]);
  });
});
