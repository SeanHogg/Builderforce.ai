import { describe, expect, it, vi } from "vitest";
import { preSearchBlock } from "./preSearchSource";

const { searches } = vi.hoisted(() => ({ searches: [] as AbortSignal[] }));
vi.mock("../ripgrep", () => ({ findRipgrep: async () => "rg" }));
vi.mock("../workspaceSearch", async (importOriginal) => ({
  // The module's constants (SKIP_DIRS, read by the symbol index at import) stay real.
  ...(await importOriginal<typeof import("../workspaceSearch")>()),
  // A search that never finishes on its own — only its signal ends it, as rg's kill does.
  searchWorkspace: (opts: { query: string; signal?: AbortSignal }) => new Promise((resolve) => {
    if (opts.signal) searches.push(opts.signal);
    opts.signal?.addEventListener("abort", () => resolve({ ok: false, query: opts.query, error: "search stopped" }), { once: true });
  }),
}));

const noSymbols = { find: async () => ({ ok: true, matches: [] }) };

describe("preSearchBlock — no search outlives the pack", () => {
  it("kills every search it started at the deadline", async () => {
    searches.length = 0;
    const started = Date.now();
    expect(await preSearchBlock("/repo", "why do resolveMembership and chargeCard fail?", 30, { symbols: noSymbols })).toBe("");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(searches).toHaveLength(2);
    expect(searches.every((s) => s.aborted)).toBe(true);
  });

  it("stops on the run's Stop before the deadline", async () => {
    searches.length = 0;
    const stop = new AbortController();
    const block = preSearchBlock("/repo", "why does resolveMembership fail?", 60_000, { symbols: noSymbols, signal: stop.signal });
    await vi.waitFor(() => expect(searches).toHaveLength(1));
    stop.abort();
    expect(await block).toBe("");
    expect(searches[0]!.aborted).toBe(true);
  });

  it("reads the run's shared symbol look-up instead of the workspace index", async () => {
    const find = vi.fn(async () => ({ ok: true, matches: [] }));
    await preSearchBlock("/repo", "why does resolveMembership fail?", 20, { symbols: { find } });
    expect(find).toHaveBeenCalledWith("resolveMembership", { limit: 20 });
  });
});
