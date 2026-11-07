#!/usr/bin/env node
/**
 * Guard: every `when` clause in package.json that reads `builderforce.signedIn`
 * MUST be on the allowlist below. Any other view/command/menu that gates on
 * `builderforce.signedIn` is a regression — the offline VSIX ships capability
 * surfaces (health, evermind) behind `builderforce.capability.*` keys instead.
 *
 * Run: `node scripts/check-signed-in-when.mjs`
 * CI:  `npm run check:signed-in-when`
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

/**
 * Views/commands/menus that are ALLOWED to read `builderforce.signedIn`.
 * These are the login gate itself and the surfaces that MUST stay behind it:
 * - Welcome panel (the sign-in UI)
 * - Work/Inbox/Changes (account-bound data)
 * Everything else must read `builderforce.capability.<name>` instead.
 */
const ALLOWLIST = new Set([
  // Views
  "builderforce.welcome",
  "builderforce.work",
  "builderforce.inbox",
  "builderforce.changes",
  // Commands
  "builderforce.signIn",
  "builderforce.signOut",
  "builderforce.openSettings",
  // Menus (view titles / context menus)
  "view/builderforce.welcome",
  "view/builderforce.work",
  "view/builderforce.inbox",
  "view/builderforce.changes",
]);

function collectWhenClauses(obj: any, path = ""): Array<{ key: string; when: string; location: string }> {
  const out: Array<{ key: string; when: string; location: string }> = [];
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const loc = path ? `${path}.${k}` : k;
    if (k === "when" && typeof v === "string" && v.includes("builderforce.signedIn")) {
      // Find the nearest id/name for reporting
      let id = "unknown";
      for (const [pk, pv] of Object.entries(obj)) {
        if (pk === "id" && typeof pv === "string") { id = pv; break; }
        if (pk === "command" && typeof pv === "string") { id = pv; break; }
      }
      out.push({ key: id, when: v, location: loc });
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => out.push(...collectWhenClauses(item, `${loc}[${i}]`)));
    } else if (typeof v === "object") {
      out.push(...collectWhenClauses(v, loc));
    }
  }
  return out;
}

const violations = collectWhenClauses(pkg).filter(({ key }) => !ALLOWLIST.has(key));

if (violations.length > 0) {
  console.error("❌  FAIL: `builderforce.signedIn` used outside the allowlist");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.key}  (${v.location})`);
    console.error(`    when: "${v.when}"`);
    console.error("");
  }
  console.error("Allowed keys:", [...ALLOWLIST].join(", "));
  console.error("");
  console.error("Fix: change the `when` clause to `builderforce.capability.<name>` and");
  console.error("ensure the capability key is granted in `capabilityContext.ts`.");
  process.exit(1);
}

console.log("✅  PASS: all `builderforce.signedIn` when-clauses are on the allowlist");