import { describe, it, expect } from "vitest";
import { computeBuildId } from "../buildId.mjs";
import { BUILD_ID, BUILT_AT, UNSTAMPED_BUILD, formatBuildIdentity, isStampedBuild } from "./buildInfo";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * A version names a RELEASE, not an ARTIFACT. Two VSIXes can carry the same version and
 * different code — that is how a rebuilt `2026.7.104` carrying an agent-stall recovery
 * fix became indistinguishable from the `2026.7.104` that lacked it, while the user who
 * hit that exact bug filed a report reading `UI 2026.7.104`. These tests pin the two
 * properties that make the stamp worth having: it changes when shipped code changes, and
 * it does NOT change when nothing shipped does.
 */
function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-buildid-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return dir;
}

describe("computeBuildId", () => {
  it("is a short, stable hex id", () => {
    const dir = fixture({ "src/a.ts": "export const a = 1;", "package.json": "{}" });
    expect(computeBuildId(dir)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic for an unchanged tree", () => {
    const dir = fixture({ "src/a.ts": "export const a = 1;", "package.json": "{}" });
    expect(computeBuildId(dir)).toBe(computeBuildId(dir));
  });

  it("changes when shipped source changes, even at the same version", () => {
    const version = '{"version":"2026.7.104"}';
    const before = fixture({ "src/a.ts": "export const a = 1;", "package.json": version });
    const after = fixture({ "src/a.ts": "export const a = 2;", "package.json": version });
    expect(computeBuildId(before)).not.toBe(computeBuildId(after));
  });

  it("changes when the WEBVIEW changes too — it ships in the same artifact", () => {
    const before = fixture({ "src/a.ts": "x", "webview/src/App.tsx": "a", "package.json": "{}" });
    const after = fixture({ "src/a.ts": "x", "webview/src/App.tsx": "b", "package.json": "{}" });
    expect(computeBuildId(before)).not.toBe(computeBuildId(after));
  });

  it("ignores tests — they never reach the artifact", () => {
    const withTest = fixture({ "src/a.ts": "x", "src/a.test.ts": "expect(1).toBe(1)", "package.json": "{}" });
    const without = fixture({ "src/a.ts": "x", "package.json": "{}" });
    expect(computeBuildId(withTest)).toBe(computeBuildId(without));
  });

  it("tolerates an absent optional root rather than throwing", () => {
    // `l10n/` is not present in every checkout; a bundler must not die over it.
    expect(() => computeBuildId(fixture({ "src/a.ts": "x" }))).not.toThrow();
  });
});

describe("buildInfo, unbundled", () => {
  it('falls back to "dev" when the esbuild defines are absent', () => {
    // These tests run from source, never from the bundle, so this is the honest value —
    // and a diagnostics report saying `dev` correctly means "not a packaged build".
    expect(BUILD_ID).toBe(UNSTAMPED_BUILD);
    expect(BUILT_AT).toBe(UNSTAMPED_BUILD);
    expect(isStampedBuild()).toBe(false);
  });

  it("formats version first, then the hash that actually distinguishes artifacts", () => {
    expect(formatBuildIdentity("2026.7.104")).toBe("2026.7.104+dev");
  });
});
