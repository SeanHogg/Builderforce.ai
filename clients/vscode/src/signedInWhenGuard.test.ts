import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { SIGNED_IN_ALLOWLIST, signedInViolations } from "../scripts/check-signed-in-when.mjs";

const manifest = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as unknown;

describe("check-signed-in-when guard (PRD 41 A1)", () => {
  it("passes on today's package.json", () => {
    expect(signedInViolations(manifest)).toEqual([]);
  });

  it("fails a new signedIn view when-clause outside the allowlist", () => {
    const added = { contributes: { views: { builderforce: [{ id: "builderforce.health", when: "builderforce.signedIn" }] } } };
    const violations = signedInViolations(added);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ owner: "builderforce.health" });
  });

  it("fails a menu or command gated on signedIn, in any combination, and an enablement", () => {
    const menu = { contributes: { menus: { "view/title": [{ command: "builderforce.scan", when: "view == x && builderforce.signedIn" }] } } };
    expect(signedInViolations(menu)).toHaveLength(1);
    const negated = { contributes: { views: { builderforce: [{ id: "builderforce.changes", when: "!builderforce.signedIn" }] } } };
    expect(signedInViolations(negated)).toHaveLength(1);
    const enablement = { contributes: { commands: [{ command: "builderforce.scan", enablement: "builderforce.signedIn" }] } };
    expect(signedInViolations(enablement)).toHaveLength(1);
  });

  it("never allows a clause with no owner id", () => {
    expect(signedInViolations({ contributes: { x: [{ when: "builderforce.signedIn" }] } })).toHaveLength(1);
  });

  it("allows the account-only surfaces", () => {
    const ok = { contributes: { views: { builderforce: SIGNED_IN_ALLOWLIST.map((id) => ({ id, when: "builderforce.signedIn" })) } } };
    expect(signedInViolations(ok)).toEqual([]);
  });

  it("treats a viewsWelcome `view` as the owner", () => {
    const welcome = { contributes: { viewsWelcome: [{ view: "builderforce.welcome", contents: "x", when: "!builderforce.signedIn" }] } };
    expect(signedInViolations(welcome)).toEqual([]);
    const other = { contributes: { viewsWelcome: [{ view: "builderforce.health", contents: "x", when: "!builderforce.signedIn" }] } };
    expect(signedInViolations(other)).toMatchObject([{ owner: "builderforce.health" }]);
  });

  it("does not match a different key that merely contains the text", () => {
    expect(signedInViolations({ views: [{ id: "a", when: "builderforce.signedInAs" }] })).toEqual([]);
  });
});

describe("no signed-in-derived context key outside the capability source (PRD 41 A1)", () => {
  const srcDir = __dirname;
  const SOURCE_OF_CAPABILITIES = new Set(["capabilityStates.ts", "capabilityContext.ts"]);
  const SET_CONTEXT = /setContext["'`]\s*,\s*["'`](builderforce\.[\w.]+)["'`]\s*,([^)]*)\)/g;

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
    });
  }

  it("derives no other builderforce.* context key from signedIn", () => {
    const offenders: string[] = [];
    for (const file of sources(srcDir)) {
      if (SOURCE_OF_CAPABILITIES.has(path.basename(file))) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(SET_CONTEXT)) {
        const [, key, value] = match;
        // `builderforce.signedIn` IS the account signal; any OTHER key computed from it belongs in capabilityStates.
        if (key !== "builderforce.signedIn" && /signedIn/i.test(value ?? "")) offenders.push(`${path.relative(srcDir, file)}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan finds the one setContext it is meant to allow", () => {
    const wiring = readFileSync(path.join(srcDir, "capabilityWiring.ts"), "utf8");
    expect([...wiring.matchAll(SET_CONTEXT)].map((m) => m[1])).toContain("builderforce.signedIn");
  });
});
