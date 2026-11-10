/**
 * The `tsc` the VSIX bundles beside its analyzers (PRD 41 A3: `typescript@<pin>`, installed into the same
 * `out/analyzers/node_modules` as dependency-cruiser and knip, `bundledAnalyzers.ts`). Found from any registered
 * analyzer entry's `node_modules`; used only when it is installed at the pinned version, so the version the delta
 * reports is the one that ran.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TYPESCRIPT_PIN } from "@builderforce/agent-tools";

const PINNED = TYPESCRIPT_PIN.slice(TYPESCRIPT_PIN.lastIndexOf("@") + 1);

/** `<…>/node_modules/typescript/bin/tsc` beside a registered entry, at the pinned version; undefined otherwise. */
export function bundledTypescriptEntry(entries: Readonly<Record<string, string | undefined>>): string | undefined {
  for (const entry of Object.values(entries)) {
    if (!entry) continue;
    const at = entry.replace(/\\/g, "/").lastIndexOf("/node_modules/");
    if (at < 0) continue;
    const dir = path.join(entry.slice(0, at), "node_modules", "typescript");
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: string };
      const tsc = path.join(dir, "bin", "tsc");
      if (manifest.version === PINNED && fs.existsSync(tsc)) return tsc.replace(/\\/g, "/");
    } catch {
      /* not bundled */
    }
  }
  return undefined;
}
