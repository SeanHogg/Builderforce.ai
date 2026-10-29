import { describe, expect, it } from "vitest";
import { schemaForCapabilities, spawnAgentTool, spawnAgentsTool } from "@builderforce/agent-tools";
import { EDITOR_DELEGATION_CAPS, LOCAL_SURFACE_CAPS } from "./localCapabilities";

/**
 * The editor's spawn tools are adapted by hand (`subagentTool.ts`, `subagentFanOutTool.ts`), so they
 * must take their description through the SAME path the registry's catalogs do - the capability set
 * the editor really holds - not read `tool.schema` and bypass it.
 */
describe("the editor's spawn tool descriptions", () => {
  it("describe background children, because the editor's children run live", () => {
    for (const tool of [spawnAgentTool, spawnAgentsTool]) {
      const description = schemaForCapabilities(tool, EDITOR_DELEGATION_CAPS).function.description;
      expect(description).toContain("IN THE BACKGROUND");
    }
  });

  it("would promise nothing live under the surface's own capabilities, which grant no delegation", () => {
    expect(LOCAL_SURFACE_CAPS.has("orchestrate.live")).toBe(false);
    expect(schemaForCapabilities(spawnAgentTool, LOCAL_SURFACE_CAPS).function.description).not.toContain("IN THE BACKGROUND");
  });
});
