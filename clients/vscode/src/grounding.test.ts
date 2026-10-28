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

import { getStableGrounding, invalidateStableGrounding, setGroundingSummary, stableGroundingWithin } from "./grounding";

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

// A cold definition index is a whole-workspace parse (minutes on a big root, e.g. the
// first open after the extractor changed). The panel's init and a run's start never wait
// on it: they post the rescan's map now and re-read once the index lands.
describe("stableGroundingWithin", () => {
  it("serves the full grounding when the build beats the deadline, and never fires onLate", async () => {
    invalidateStableGrounding();
    const onLate = vi.fn();
    expect(await stableGroundingWithin("/repo", 1_000, { onLate })).toBe("## Map\n\n## Repo map\n\n## Symbol index");
    await new Promise((r) => setTimeout(r, 0));
    expect(onLate).not.toHaveBeenCalled();
  });

  it("serves the map alone past the deadline, then fires onLate once the index lands", async () => {
    invalidateStableGrounding();
    let finish!: (v: string) => void;
    symbols.mockImplementationOnce(() => new Promise<string>((r) => { finish = r; }));
    const onLate = vi.fn();
    expect(await stableGroundingWithin("/repo", 10, { onLate })).toBe("## Map");
    expect(onLate).not.toHaveBeenCalled();
    finish("## Symbol index");
    await vi.waitFor(() => expect(onLate).toHaveBeenCalledTimes(1));
    expect(await getStableGrounding("/repo")).toBe("## Map\n\n## Repo map\n\n## Symbol index");
  });

  it("does not fire onLate for a build that failed after the deadline", async () => {
    invalidateStableGrounding();
    let fail!: (e: Error) => void;
    repoMap.mockImplementationOnce(() => new Promise<string>((_, reject) => { fail = reject; }));
    const onLate = vi.fn();
    expect(await stableGroundingWithin("/repo", 10, { onLate })).toBe("## Map");
    fail(new Error("desktop gone"));
    await new Promise((r) => setTimeout(r, 0));
    expect(onLate).not.toHaveBeenCalled();
  });

  it("late with late: \"nothing\", hands back undefined so a run keeps the map its prompt already has", async () => {
    invalidateStableGrounding();
    let finish!: (v: string) => void;
    symbols.mockImplementationOnce(() => new Promise<string>((r) => { finish = r; }));
    expect(await stableGroundingWithin("/repo", 10, { late: "nothing" })).toBeUndefined();
    finish("## Symbol index");
  });
});
