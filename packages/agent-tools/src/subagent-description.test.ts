import { describe, expect, it } from "vitest";
import type { Capability } from "./capabilities.js";
import { BLOCKING_DELEGATION_NOTE } from "./live-subagent-tools.js";
import { ToolRegistry } from "./registry.js";
import { SUBAGENT_TOOLS, spawnAgentTool } from "./subagent-tools.js";

/**
 * A spawn tool must not promise what its surface cannot do: background children and the
 * wait/message/stop verbs exist only where children run live (`orchestrate.live`). ONE description
 * source; the capability the surface grants picks the note that is true for it.
 */
function registry(): ToolRegistry {
  const r = new ToolRegistry();
  for (const tool of SUBAGENT_TOOLS) r.register(tool);
  return r;
}
const descriptionOf = (caps: Capability[], tool: string): string =>
  registry().schemasForCapabilities(new Set(caps)).find((s) => s.function.name === tool)?.function.description ?? "";

describe("spawn tool descriptions follow the granted capability", () => {
  it("promises nothing live where children block (orchestrate only)", () => {
    for (const [caps, tool] of [[["orchestrate"], "spawn_agent"], [["orchestrate", "orchestrate.fanout"], "spawn_agents"]] as const) {
      const text = descriptionOf([...caps], tool);
      expect(text).toContain(BLOCKING_DELEGATION_NOTE);
      expect(text).not.toMatch(/IN THE BACKGROUND|wait_agents|message_agent|stop_agent/);
    }
  });

  it("describes background children where they run live", () => {
    for (const [caps, tool] of [[["orchestrate", "orchestrate.live"], "spawn_agent"], [["orchestrate", "orchestrate.live", "orchestrate.fanout"], "spawn_agents"]] as const) {
      const text = descriptionOf([...caps], tool);
      expect(text).toContain("IN THE BACKGROUND");
      expect(text).toContain("wait_agents");
      expect(text).not.toContain(BLOCKING_DELEGATION_NOTE);
    }
  });

  it("offers the owner's control verbs only where children run live", () => {
    const names = (caps: Capability[]) => registry().schemasForCapabilities(new Set(caps)).map((s) => s.function.name);
    expect(names(["orchestrate"])).not.toContain("wait_agents");
    expect(names(["orchestrate", "orchestrate.live"])).toContain("wait_agents");
  });

  it("leaves the tool's own schema as written (the live text), for a surface that reads it directly", () => {
    expect(spawnAgentTool.schema.function.description).toContain("IN THE BACKGROUND");
  });
});
