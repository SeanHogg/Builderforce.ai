/**
 * symbolImports.ts — what one JS/TS file imports, by local name (`import … from "…"`, type-only ones included), for the
 * symbol relations (`symbolRelations.ts`) to resolve a name to the module it comes from. Pure.
 */

import { ID } from "./callScan.js";

export interface Import { module: string; name: string; namespace: boolean }

const IMPORT_START = /^[ \t]*import[\s{*]/;
const FROM_SPEC = /\bfrom\s*["'][^"']+["']/;
const IMPORT_STATEMENT = /^[ \t]*import\s+(?:type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/;
const IMPORT_NAMED = new RegExp(`^\\s*(?:type\\s+)?(${ID})(?:\\s+as\\s+(${ID}))?\\s*$`);
const IMPORT_NAMESPACE = new RegExp(`\\*\\s*as\\s+(${ID})`);
const IMPORT_DEFAULT = new RegExp(`^\\s*(${ID})\\s*(?:,|$)`);

/** `local name → what it imports`, from the file's `import … from "…"` statements. `masked` decides; `lines` is read. */
export function importsOf(lines: readonly string[], masked: readonly string[]): Map<string, Import> {
  const out = new Map<string, Import>();
  for (let l = 0; l < lines.length; l += 1) {
    // Decided on the MASKED line, so an `import … from` inside a string, template or comment is no import; read from the raw one.
    if (!IMPORT_START.test(masked[l] ?? "")) continue;
    // The statement: this line and the next ones until its `from "…"` (a long named list spans lines).
    let statement = lines[l]!;
    for (let k = l + 1; k < Math.min(lines.length, l + 60) && !FROM_SPEC.test(statement) && !statement.includes(";"); k += 1) statement += ` ${lines[k]}`;
    const m = IMPORT_STATEMENT.exec(statement);
    if (!m) continue;
    const clause = m[1] ?? "", module = m[2] ?? "";
    const named = /\{([^}]*)\}/.exec(clause);
    for (const part of (named?.[1] ?? "").split(",")) {
      const p = IMPORT_NAMED.exec(part);
      if (p) out.set(p[2] ?? p[1]!, { module, name: p[1]!, namespace: false });
    }
    const rest = clause.replace(/\{[^}]*\}/, "");
    const ns = IMPORT_NAMESPACE.exec(rest);
    if (ns) out.set(ns[1]!, { module, name: "*", namespace: true });
    const def = IMPORT_DEFAULT.exec(rest);
    if (def && def[1] !== "type") out.set(def[1]!, { module, name: "default", namespace: false });
  }
  return out;
}
