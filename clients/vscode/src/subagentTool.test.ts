import { describe, expect, it, vi } from "vitest";
import { subagentToolDef } from "./subagentTool";
import type { ToolDef } from "./fileTools";
import type { ChildControls, ChildRequest } from "./childRunSpawner";

/**
 * Delegation on the MACHINE. A child is an ordinary run with an owner pointer, started
 * in the background: `spawn_agent` resolves WHO does the slice, hands the owner's
 * controls one request, and returns the child's handle at once — the owner keeps working.
 */

const def = (name: string, over: Partial<ToolDef> = {}): ToolDef => ({
  name,
  description: name,
  parameters: { type: "object" },
  mutating: false,
  execute: async () => "{}",
  ...over,
});

/** Controls that record what the owner asked for, and start nothing. */
function fakeControls(over: Partial<ChildControls> = {}): ChildControls & { requests: ChildRequest[] } {
  const requests: ChildRequest[] = [];
  return {
    requests,
    canSpawn: true,
    spawn: vi.fn((req: ChildRequest) => {
      requests.push(req);
      return { ok: true as const, handle: `a${requests.length}`, name: req.asAgent?.name ?? req.persona?.name ?? req.label, label: req.label };
    }),
    message: vi.fn(() => ({ ok: true as const })),
    stop: vi.fn(() => []),
    wait: vi.fn(async () => ({ reports: [], running: [] })),
    ...over,
  };
}

describe("subagentToolDef", () => {
  it("takes its schema from the shared definition and says the child runs in the background", () => {
    const tool = subagentToolDef({ children: fakeControls() });
    expect(tool.name).toBe("spawn_agent");
    expect(tool.description).toContain("IN THE BACKGROUND");
  });

  it("starts the child and returns its handle at once — the owner is not blocked", async () => {
    const children = fakeControls();
    const out = JSON.parse(await subagentToolDef({ children }).execute({ label: "look", task: "find the auth middleware" }, "/repo"));
    expect(out).toMatchObject({ ok: true, handle: "a1", running: true });
    expect(children.requests[0]).toEqual({ label: "look", task: "find the auth middleware", role: "code" });
  });

  it("refuses an empty brief — the child sees nothing else", async () => {
    const children = fakeControls();
    const out = JSON.parse(await subagentToolDef({ children }).execute({ label: "x", task: "  " }, "/repo"));
    expect(out.ok).toBe(false);
    expect(children.spawn).not.toHaveBeenCalled();
  });

  it("starts a clone — a stray read_only from an older prompt changes nothing", async () => {
    const children = fakeControls();
    const out = JSON.parse(await subagentToolDef({ children }).execute({ label: "fix", task: "fix it", read_only: true }, "/repo"));
    expect(children.requests[0]).toEqual({ label: "fix", task: "fix it", role: "code" });
    expect(out.readOnly).toBeUndefined();
  });

  it("passes a refusal from the controls back to the owner", async () => {
    const children = fakeControls({ spawn: vi.fn(() => ({ ok: false as const, error: "12 sub-agents are already working" })) });
    const out = JSON.parse(await subagentToolDef({ children }).execute({ label: "x", task: "y" }, "/repo"));
    expect(out).toMatchObject({ ok: false, error: "12 sub-agents are already working" });
  });

  describe("as_agent — running a slice in a team agent's persona", () => {
    const ADA = { ref: "agent_12", name: "Ada", brief: "Backend Engineer — owns the auth and billing services." };

    it("resolves the persona and starts the child AS that agent", async () => {
      const personaBrief = vi.fn(async () => ADA);
      const children = fakeControls();
      const out = JSON.parse(await subagentToolDef({ children, personaBrief }).execute({ label: "port the auth middleware", task: "port it", as_agent: "Ada" }, "/repo"));
      expect(personaBrief).toHaveBeenCalledWith("Ada");
      expect(children.requests[0]!.asAgent).toEqual({ ref: "agent_12", name: "Ada" });
      expect(out.name).toBe("Ada");
    });

    it("refuses an agent this workspace does not have, and starts no child", async () => {
      const children = fakeControls();
      const out = JSON.parse(await subagentToolDef({ children, personaBrief: async () => null }).execute({ label: "port it", task: "port it", as_agent: "Nobody" }, "/repo"));
      expect(out.ok).toBe(false);
      expect(out.error).toContain("no agent named 'Nobody' in this workspace");
      expect(out.error).toContain("builtin_chats_list_agents");
      expect(children.spawn).not.toHaveBeenCalled();
    });

    it("refuses when the host cannot name personas at all", async () => {
      const children = fakeControls();
      const out = JSON.parse(await subagentToolDef({ children }).execute({ label: "port it", task: "port it", as_agent: "Ada" }, "/repo"));
      expect(out.ok).toBe(false);
      expect(children.spawn).not.toHaveBeenCalled();
    });

    it("runs a verify slice for an agent with no QA role as an on-demand QA Tester, unattributed", async () => {
      const children = fakeControls();
      const out = JSON.parse(await subagentToolDef({ children, personaBrief: async () => ({ ...ADA, roleKeys: ["developer"] }) })
        .execute({ label: "check it", task: "review the diff", as_agent: "Ada", role: "verify" }, "/repo"));
      expect(out.ok).toBe(true);
      expect(children.requests[0]!.asAgent).toBeUndefined();
      expect(out.staffing).toContain("on-demand QA Tester");
      expect(out.staffing).toContain("not attributed to Ada");
    });

    it("staffs a Developer for a code slice nobody fitting was named for, and runs AS them", async () => {
      const children = fakeControls();
      const staffRole = vi.fn(async () => ({ ref: "agent_dev", name: "Developer", brief: "Developer", roleKeys: ["developer"], created: true }));
      const out = JSON.parse(await subagentToolDef({ children, personaBrief: async () => ADA, staffRole }).execute({ label: "port it", task: "port the module", role: "code" }, "/repo"));
      expect(staffRole).toHaveBeenCalledWith("developer", undefined);
      expect(children.requests[0]!.asAgent).toEqual({ ref: "agent_dev", name: "Developer" });
      expect(out.staffing).toContain("hired as developer");
    });

    it("staffs past a named teammate who lacks the role, instead of refusing", async () => {
      const children = fakeControls();
      const staffRole = vi.fn(async () => ({ ref: "agent_bob", name: "Bob", brief: "Bob", roleKeys: ["developer"], created: false }));
      const out = JSON.parse(await subagentToolDef({ children, personaBrief: async () => ({ ...ADA, roleKeys: ["product-manager"] }), staffRole })
        .execute({ label: "port it", task: "port it", as_agent: "Ada", role: "code" }, "/repo"));
      expect(children.requests[0]!.asAgent).toEqual({ ref: "agent_bob", name: "Bob" });
      expect(out.staffing).toContain("Ada does not hold developer");
    });

    it("leaves an ordinary delegation untouched", async () => {
      const personaBrief = vi.fn(async () => ADA);
      const children = fakeControls();
      await subagentToolDef({ children, personaBrief }).execute({ label: "look", task: "find it" }, "/repo");
      expect(personaBrief).not.toHaveBeenCalled();
      expect(children.requests[0]!.asAgent).toBeUndefined();
    });
  });
});
