import { beforeEach, describe, expect, it, vi } from "vitest";

// WS-C: the stable grounding is computed ONCE and reused until a rescan or an explicit
// refresh — the live Desktop map and the symbol index no longer change the cached
// system prompt between runs.

const repoMap = vi.hoisted(() => vi.fn(async () => "## Repo map"));
const symbols = vi.hoisted(() => vi.fn(async () => "## Symbol index"));

vi.mock("./desktopContext", () => ({ desktopRepoMapSection: repoMap }));
vi.mock("./workspaceSymbols", () => ({ symbolIndexGrounding: symbols }));
vi.mock("./hostCostLevers", () => ({ hostCostLeverOn: () => false }));
vi.mock("./sessionNotes", () => ({ readRecentSessionNotes: async () => "" }));

import { getStableGrounding, invalidateStableGrounding, setGroundingSummary } from "./grounding";

beforeEach(() => {
  setGroundingSummary("## Map");
  repoMap.mockClear();
  symbols.mockClear();
});

describe("getStableGrounding memo", () => {
  it("computes once and serves the same text on later calls", async () => {
    const first = await getStableGrounding("/repo");
    symbols.mockResolvedValueOnce("## Symbol index (changed on save)");
    const second = await getStableGrounding("/repo");
    expect(second).toBe(first);
    expect(first).toBe("## Map\n\n## Repo map\n\n## Symbol index");
    expect(repoMap).toHaveBeenCalledTimes(1);
    expect(symbols).toHaveBeenCalledTimes(1);
  });

  it("recomputes after a rescan (a new summary)", async () => {
    await getStableGrounding("/repo");
    setGroundingSummary("## Map v2");
    expect(await getStableGrounding("/repo")).toBe("## Map v2\n\n## Repo map\n\n## Symbol index");
    expect(symbols).toHaveBeenCalledTimes(2);
  });

  it("recomputes after an explicit refresh, and for another workspace root", async () => {
    await getStableGrounding("/repo");
    invalidateStableGrounding();
    await getStableGrounding("/repo");
    await getStableGrounding("/other");
    expect(symbols).toHaveBeenCalledTimes(3);
  });

  it("with no root, is just the map", async () => {
    expect(await getStableGrounding(undefined)).toBe("## Map");
    expect(symbols).not.toHaveBeenCalled();
  });
});
