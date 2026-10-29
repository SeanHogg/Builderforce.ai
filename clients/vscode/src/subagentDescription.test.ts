import { describe, expect, it } from "vitest";
import { schemaForCapabilities, spawnAgentTool } from "@builderforce/agent-tools";
import type { ChildControls } from "./childRunSpawner";
import { LOCAL_SURFACE_CAPS } from "./localCapabilities";
import { subagentFanOutToolDef } from "./subagentFanOutTool";
import { subagentToolDef } from "./subagentTool";

/**
 * The editor adapts the spawn tools by hand, so what the MODEL reads is the `ToolDef` it builds -
 * which must take its description through the same path the registry's catalogs do, under the
 * capabilities the editor really holds (its children run live), rather than reading `tool.schema`.
 */
const deps = { children: {} as ChildControls };

describe("the spawn tools the editor builds", () => {
  it("describe background children, because the editor's children run live", () => {
    for (const def of [subagentToolDef(deps), subagentFanOutToolDef(deps)]) {
      expect(def.description, def.name).toContain("IN THE BACKGROUND");
      expect(def.description, def.name).not.toContain("BLOCKS");
    }
  });

  it("is the description the capability path gives - not a hand-picked copy of the schema", () => {
    expect(subagentToolDef(deps).description).toBe(
      schemaForCapabilities(spawnAgentTool, new Set([...LOCAL_SURFACE_CAPS, "orchestrate", "orchestrate.live"])).function.description,
    );
  });
});
