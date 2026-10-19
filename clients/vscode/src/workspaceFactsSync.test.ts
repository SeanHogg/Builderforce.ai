import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { destinationKey } from "@builderforce/local-first";
import { classifyQueue } from "@builderforce/write-outbox";

const getSelectedProject = vi.hoisted(() => vi.fn());

vi.mock("./projectState", () => ({
  getSelectedProject,
}));

vi.mock("./bfApi", () => ({
  rememberProjectFact: vi.fn(async () => true),
  forgetProjectFact: vi.fn(async () => true),
}));

vi.mock("./workspaceSymbols", () => ({
  workspaceSymbolIndex: () => ({
    refresh: async () => {},
    filesUnder: () => [],
  }),
}));

import { rememberProjectFact } from "./bfApi";
import { afterWorkspaceScan, rebindWorkspaceFactsDestination, syncWorkspaceFacts } from "./workspaceFactsSync";

const secrets = {} as never;
const scan = { grounding: "", manifests: [] as string[], overview: "A small workspace." };

describe("workspaceFactsSync destination snapshot", () => {
  let root = "";

  afterEach(async () => {
    getSelectedProject.mockReset();
    vi.mocked(rememberProjectFact).mockReset();
    vi.mocked(rememberProjectFact).mockResolvedValue(true);
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  async function scanInto(project: { id: number; name: string } | undefined): Promise<void> {
    root = await mkdtemp(path.join(tmpdir(), "bf-facts-"));
    getSelectedProject.mockReturnValue(project);
    await afterWorkspaceScan(secrets, root, scan);
  }

  it("publishes to the project snapshotted at scan, not the project selected at send", async () => {
    await scanInto({ id: 7, name: "Pinned" });
    getSelectedProject.mockReset();
    getSelectedProject.mockReturnValue({ id: 99, name: "Switched" });

    await syncWorkspaceFacts(secrets);

    expect(getSelectedProject).not.toHaveBeenCalled();
    const calls = vi.mocked(rememberProjectFact).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call[1] === 7)).toBe(true);
    expect(calls.some((call) => call[1] === 99)).toBe(false);
    const state = JSON.parse(await readFile(path.join(root, ".builderforce", "facts-published.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(state)).toEqual(["7"]);
    expect(destinationKey({ kind: "bound", projectId: "7" })).not.toBe(destinationKey({ kind: "bound", projectId: "99" }));
  });

  it("does not publish an unbound snapshot when a project is selected later", async () => {
    await scanInto(undefined);
    getSelectedProject.mockReset();
    getSelectedProject.mockReturnValue({ id: 99, name: "Later" });

    await syncWorkspaceFacts(secrets);

    expect(getSelectedProject).not.toHaveBeenCalled();
    expect(rememberProjectFact).not.toHaveBeenCalled();
  });

  it("moves the pending digest only through an explicit rebind, not a lookup", async () => {
    await scanInto({ id: 7, name: "Pinned" });
    vi.mocked(rememberProjectFact).mockClear();
    getSelectedProject.mockReset();
    getSelectedProject.mockReturnValue({ id: 99, name: "Ignored" });

    rebindWorkspaceFactsDestination({ id: 3, name: "Rebound" });
    await syncWorkspaceFacts(secrets);

    expect(getSelectedProject).not.toHaveBeenCalled();
    const calls = vi.mocked(rememberProjectFact).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call[1] === 3)).toBe(true);
    expect(calls.some((call) => call[1] === 99)).toBe(false);
  });

  it("retains a failed fact publish until the platform acknowledges it", async () => {
    vi.mocked(rememberProjectFact).mockResolvedValue(false);
    root = await mkdtemp(path.join(tmpdir(), "bf-facts-"));
    getSelectedProject.mockReturnValue({ id: 11, name: "Held" });

    await expect(afterWorkspaceScan(secrets, root, scan)).rejects.toThrow(/not acknowledged/);

    const retained = JSON.parse(await readFile(path.join(root, ".builderforce", "facts-retained.json"), "utf8")) as Array<{
      projectId: number;
      op: string;
      content: string;
    }>;
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.every((item) => item.projectId === 11 && item.op === "remember" && item.content.length > 0)).toBe(true);
    const published = JSON.parse(await readFile(path.join(root, ".builderforce", "facts-published.json"), "utf8")) as Record<string, Record<string, string>>;
    expect(published["11"] ?? {}).toEqual({});

    vi.mocked(rememberProjectFact).mockResolvedValue(true);
    await syncWorkspaceFacts(secrets);

    await expect(readFile(path.join(root, ".builderforce", "facts-retained.json"), "utf8")).rejects.toThrow();
    const acked = JSON.parse(await readFile(path.join(root, ".builderforce", "facts-published.json"), "utf8")) as Record<string, Record<string, string>>;
    expect(Object.keys(acked["11"] ?? {}).length).toBeGreaterThan(0);
  });

  it("classifies fact-publish as durable user work that must be retained", () => {
    expect(classifyQueue("fact-publish")?.retention).toBe("durable");
    expect(classifyQueue("fact-publish")?.onFailure).toBe("retain-until-acked");
  });
});
