#!/usr/bin/env node
/**
 * Guard (PRD 41 A1, done-check "No view or command uses `builderforce.signedIn` except account-only
 * ones"): every `when` clause in `package.json` that reads `builderforce.signedIn` must belong to an
 * allowlisted, account-only contribution. Anything else gates on a CAPABILITY key
 * (`builderforce.capability.<id>`, derived in `src/capabilityStates.ts`) so a signed-out, offline
 * workspace still shows it.
 *
 * Run: `node scripts/check-signed-in-when.mjs` from `clients/vscode` (wired into `pnpm run type-check`,
 * which CI runs as the `type-check` leg of "Verify VS Code extension").
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The account-only contributions that may read `builderforce.signedIn`, by `id` (views) or `command`
 * (menus, keybindings) or `view` (viewsWelcome). Welcome IS the sign-in surface; Work (tickets) and Inbox are account data
 * (PRD 41 A1 table: "Tickets, inbox, cloud runs, team features").
 */
export const SIGNED_IN_ALLOWLIST = Object.freeze(["builderforce.welcome", "builderforce.work", "builderforce.inbox"]);

const KEY = /\bbuilderforce\.signedIn\b/;

/** Every `when` / `enablement` string that reads the key, with the contribution it belongs to. */
export function signedInClauses(node, trail = "package.json") {
  const found = [];
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((item, index) => found.push(...signedInClauses(item, `${trail}[${index}]`)));
    return found;
  }
  const owner = typeof node.id === "string" ? node.id : typeof node.command === "string" ? node.command : typeof node.view === "string" ? node.view : undefined; // `view`: viewsWelcome entries
  for (const [key, value] of Object.entries(node)) {
    if ((key === "when" || key === "enablement") && typeof value === "string" && KEY.test(value)) {
      found.push({ owner, clause: value, at: `${trail}.${key}` });
    } else if (value && typeof value === "object") {
      found.push(...signedInClauses(value, `${trail}.${key}`));
    }
  }
  return found;
}

/** The clauses outside the allowlist. A clause with no owner id is never allowed. */
export function signedInViolations(manifest, allowlist = SIGNED_IN_ALLOWLIST) {
  const allowed = new Set(allowlist);
  return signedInClauses(manifest).filter(({ owner }) => !owner || !allowed.has(owner));
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
  const violations = signedInViolations(manifest);
  if (violations.length === 0) {
    console.log("check-signed-in-when: ok - every builderforce.signedIn clause is on the allowlist");
    return;
  }
  console.error("check-signed-in-when: FAIL - builderforce.signedIn used outside the account-only allowlist\n");
  for (const v of violations) console.error(`  ${v.owner ?? "(no id)"}  ${v.at}\n    when: ${v.clause}\n`);
  console.error(`Allowed: ${SIGNED_IN_ALLOWLIST.join(", ")}`);
  console.error("Fix: gate on `builderforce.capability.<id>` (src/capabilityStates.ts) instead of the login state.");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
