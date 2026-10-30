import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { schemaForCapabilities, spawnAgentTool, spawnAgentsTool } from "@builderforce/agent-tools";
import type { ChildControls } from "./childRunSpawner";
import { EDITOR_DELEGATION_CAPS, LOCAL_SURFACE_CAPS } from "./localCapabilities";
import { subagentFanOutToolDef } from "./subagentFanOutTool";
import { subagentToolDef } from "./subagentTool";

/**
 * The editor adapts the spawn tools by hand, so what the MODEL reads is the `ToolDef` it builds -
 * which must take its description through the same path the registry's catalogs do, under the
 * capabilities the editor really holds (its children run live), rather than reading `tool.schema`.
 */
const deps = { children: {} as ChildControls };

/** An INDEPENDENT statement of what the editor holds, spelled out - never the expression the code under test uses. */
const EXPECTED_CAPS: ReadonlySet<Capability> = new Set<Capability>([...LOCAL_SURFACE_CAPS, "orchestrate", "orchestrate.fanout", "orchestrate.live"]);

describe("the spawn tools the editor builds", () => {
  it("describe background children, because the editor's children run live", () => {
    for (const def of [subagentToolDef(deps), subagentFanOutToolDef(deps)]) {
      expect(def.description, def.name).toContain("IN THE BACKGROUND");
      expect(def.description, def.name).not.toContain("BLOCKS");
    }
  });

  it("is the description the capability path gives under the capabilities the editor holds - for both tools", () => {
    expect(subagentToolDef(deps).description).toBe(schemaForCapabilities(spawnAgentTool, EXPECTED_CAPS).function.description);
    expect(subagentFanOutToolDef(deps).description).toBe(schemaForCapabilities(spawnAgentsTool, EXPECTED_CAPS).function.description);
  });

  it("holds exactly the surface's own capabilities plus delegation, fan-out and live", () => {
    expect([...EDITOR_DELEGATION_CAPS].sort()).toEqual([...EXPECTED_CAPS].sort());
    for (const tool of [spawnAgentTool, spawnAgentsTool]) {
      for (const needed of tool.requires) expect(EXPECTED_CAPS.has(needed), `${tool.name} requires ${needed}`).toBe(true);
    }
  });
});
