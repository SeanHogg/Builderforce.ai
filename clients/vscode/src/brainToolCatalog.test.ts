import { describe, expect, it, vi } from "vitest";

/**
 * The catalog an owner run executes refuses a `run_command` that a live child of its own was
 * briefed to run (chat #60338) — proven through `brainToolCatalog`, not the guard alone.
 */

const { ran } = vi.hoisted(() => ({ ran: [] as string[] }));

vi.mock("@seanhogg/builderforce-brain-embedded", () => ({
  codeChangesOf: () => [],
  getRunSnapshot: () => ({ appended: [], error: "" }),
  getRunTrace: () => [],
  isModelReply: () => false,
  queueRunSteering: vi.fn(),
}));
vi.mock("./fileTools", () => ({
  TOOL_DEFS: [
    {
      name: "run_command",
      description: "",
      parameters: {},
      mutating: true,
      execute: async (args: Record<string, unknown>) => {
        ran.push(String(args.command));
        return JSON.stringify({ ok: true });
      },
    },
  ],
}));
vi.mock("./cognition", () => ({ cognitionToolDefs: () => [] }));
vi.mock("./platformTools", () => ({ listPlatformTools: async () => [] }));
vi.mock("./subagentTool", () => ({ subagentToolDef: () => ({ name: "spawn_agent", description: "", parameters: {}, mutating: false, execute: async () => "" }) }));
vi.mock("./subagentFanOutTool", () => ({ subagentFanOutToolDef: () => ({ name: "spawn_agents", description: "", parameters: {}, mutating: false, execute: async () => "" }) }));
vi.mock("./subagentControlTools", () => ({ subagentControlToolDefs: () => [] }));
vi.mock("./ticketBranchTool", () => ({ ticketBranchReviewToolDef: () => ({ name: "ticket_branch_review", description: "", parameters: {}, mutating: false, execute: async () => "" }) }));
vi.mock("./desktopContext", () => ({ desktopBackedTools: async (tools: unknown) => tools }));
vi.mock("./localResearch/researchPort", () => ({ withLocalResearch: async (tools: unknown) => tools }));

import type * as vscode from "vscode";
import { brainToolCatalog } from "./brainToolCatalog";
import { childControls, type ChildRunHost } from "./childRunSpawner";
import { createChildRuns } from "./childRuns";

const OWNER = { key: 7, rootChatId: 7, name: "Ada", depth: 0 };
const secrets = {} as vscode.SecretStorage;

function liveChildHost(): ChildRunHost {
  return {
    registry: createChildRuns(),
    // The child keeps running for the whole test.
    startChild: () => new Promise<void>(() => undefined),
    stop: () => undefined,
    wake: () => true,
    postDirection: () => undefined,
    changed: () => undefined,
  };
}

describe("brainToolCatalog guards the owner's run_command against its live children", () => {
  it("refuses a command in a live child's brief and runs an unrelated one", async () => {
    ran.length = 0;
    const children = childControls(liveChildHost(), OWNER);
    children.spawn({ label: "verify", task: "Report whether the build is green.\n- pnpm exec tsc --noEmit", role: "verify" });

    const catalog = await brainToolCatalog(secrets, "/repo", undefined, children);
    const shell = catalog.find((t) => t.name === "run_command")!;

    expect(JSON.parse(await shell.execute({ command: "pnpm exec tsc --noEmit" }, "/repo"))).toMatchObject({
      ok: false,
      refused: true,
      error: "a1 is already running this — call wait_agents for its result",
    });
    expect(ran).toEqual([]);

    await shell.execute({ command: "git status" }, "/repo");
    expect(ran).toEqual(["git status"]);
  });

  it("leaves run_command untouched for a run with no children", async () => {
    ran.length = 0;
    const catalog = await brainToolCatalog(secrets, "/repo", undefined);
    await catalog.find((t) => t.name === "run_command")!.execute({ command: "pnpm exec tsc --noEmit" }, "/repo");
    expect(ran).toEqual(["pnpm exec tsc --noEmit"]);
  });
});
