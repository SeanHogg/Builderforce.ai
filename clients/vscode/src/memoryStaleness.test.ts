import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EvermindRunHooks } from "@seanhogg/builderforce-brain-embedded";
import { setDesktopFetchForTests } from "./desktopContext";
import { staleNote, staleReferences, withWorkspaceStaleness } from "./memoryStaleness";

const hooks: EvermindRunHooks = {
  recall: async () => ({
    seeded: true,
    version: 3,
    mode: "connected",
    items: [
      { id: 1, text: "Billing goes through `applyStripeWebhook()`.", score: 0.9 },
      { id: 2, text: "Use `retiredHelper()` for retries.", score: 0.7 },
    ],
  }),
};

describe("memory staleness", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stale-"));
    process.env.BUILDERFORCE_DESKTOP_DISCOVERY = path.join(dir, "desktop.json");
  });

  afterEach(() => {
    setDesktopFetchForTests(null);
    delete process.env.BUILDERFORCE_DESKTOP_DISCOVERY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes memories through untouched when the desktop service is absent", async () => {
    setDesktopFetchForTests(async () => new Response("{}", { status: 500 }));
    const wrapped = withWorkspaceStaleness(hooks, "/repo");
    const r = await wrapped.recall("billing");
    expect(r?.items.map((i) => i.text)).toEqual([
      "Billing goes through `applyStripeWebhook()`.",
      "Use `retiredHelper()` for retries.",
    ]);
    expect(await staleReferences("/repo", ["a", "b"])).toEqual([[], []]);
  });

  it("annotates only the recalled memory whose references are gone", async () => {
    fs.writeFileSync(process.env.BUILDERFORCE_DESKTOP_DISCOVERY!, JSON.stringify({ port: 4999, token: "tok", pid: 1, version: "x" }));
    setDesktopFetchForTests(async (url) => {
      if (url.endsWith("/v1/health")) return new Response("{}", { status: 200 });
      return new Response(
        JSON.stringify({ results: [{ index: 1, missing: [{ reference: "retiredHelper", kind: "symbol" }] }], status: { phase: { state: "ready" } } }),
        { status: 200 },
      );
    });
    const r = await withWorkspaceStaleness(hooks, "/repo").recall("retries");
    expect(r?.items[0]?.text).toBe("Billing goes through `applyStripeWebhook()`.");
    expect(r?.items[1]?.text).toContain(staleNote([{ reference: "retiredHelper", kind: "symbol" }]));
    expect(r?.items[1]?.text).toContain("POSSIBLY STALE");
  });

  it("leaves hooks alone with no folder open", () => {
    expect(withWorkspaceStaleness(hooks, undefined)).toBe(hooks);
    expect(withWorkspaceStaleness(undefined, "/repo")).toBeUndefined();
  });
});
