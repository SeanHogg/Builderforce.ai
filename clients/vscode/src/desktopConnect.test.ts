import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A Desktop that starts AFTER the workspace was grounded: its start (the discovery file
// it writes) drops the memoised grounding, so the next run carries its repo map.

const { repoMap, forgetDesktopProbe, registerWorkspace } = vi.hoisted(() => ({
  repoMap: vi.fn(async (): Promise<string | undefined> => undefined),
  forgetDesktopProbe: vi.fn(),
  registerWorkspace: vi.fn(async () => true),
}));
vi.mock("./desktopContext", () => ({
  desktopRepoMapSection: repoMap,
  discoveryFilePath: () => path.join(os.tmpdir(), "bf-never-used.json"),
  forgetDesktopProbe,
  registerWorkspace,
}));
vi.mock("./workspaceSymbols", () => ({ symbolIndexGrounding: async () => undefined }));
vi.mock("./hostCostLevers", () => ({ hostCostLeverOn: () => false }));
vi.mock("./sessionNotes", () => ({ readRecentSessionNotes: async () => "" }));

import { onDesktopStart, watchDesktopStarts } from "./desktopConnect";
import { getStableGrounding, setGroundingSummary } from "./grounding";

describe("Desktop's start event", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "bf-desktop-"));
    setGroundingSummary("## Map");
    repoMap.mockClear();
    forgetDesktopProbe.mockClear();
    registerWorkspace.mockClear();
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("fires when the discovery file appears — Desktop started for the first time", async () => {
    const file = path.join(dir, "desktop.json");
    const onStart = vi.fn();
    const watch = watchDesktopStarts(onStart, 20, file);
    try {
      await fs.writeFile(file, JSON.stringify({ port: 1, token: "t" }));
      await vi.waitFor(() => expect(onStart).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    } finally {
      watch.dispose();
    }
  });

  it("re-grounds the next run with Desktop's repo map, re-probes, and hands Desktop the folder", async () => {
    expect(await getStableGrounding("/repo")).toBe("## Map");
    repoMap.mockResolvedValue("## Repo map");
    // Memoised: without the start event the map stays absent.
    expect(await getStableGrounding("/repo")).toBe("## Map");
    onDesktopStart("/repo");
    expect(forgetDesktopProbe).toHaveBeenCalledTimes(1);
    expect(registerWorkspace).toHaveBeenCalledWith("/repo");
    expect(await getStableGrounding("/repo")).toBe("## Map\n\n## Repo map");
  });
});
