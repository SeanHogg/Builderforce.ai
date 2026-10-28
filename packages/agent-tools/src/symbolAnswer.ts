/**
 * "Where is X defined?" answered from the definition index with NO model call.
 *
 * The question is common, the answer is a lookup, and a paid model spends a turn and a
 * tool call to produce it. So the run's turn-0 short-circuit asks this first: when the
 * request is ONLY a where-question (nothing else asked of the run) and the index resolves
 * EVERY identifier it names to an exact definition, the answer is rendered here and the
 * model is never called. Anything less — an extra instruction, one unresolved name — and
 * it returns null, so the run proceeds exactly as before.
 *
 * Pure: the index is an injected port.
 */

import type { SymbolFindResult, SymbolMatch } from "./capabilities.js";

/** Locations listed per identifier before "+N more". */
const MAX_LOCATIONS = 5;
/** A where-question is short; a long request is a task that happens to start with "where". */
const MAX_QUESTION_CHARS = 160;

/** How a where-question opens — also the PreFetch gate's tier-1 rule for `symbols.where-defined`. */
export const WHERE_DEFINED_LEAD = /^\s*(?:(?:hey|ok|so|please)[,\s]+)?(?:where(?:'s|\s+is|\s+are|\s+do\s+we\s+define|\s+do\s+i\s+find|\s+can\s+i\s+find)?|in\s+which\s+file\s+(?:is|are)|which\s+file\s+(?:defines|declares|has|contains)|find\s+(?:the\s+)?definition\s+of|locate)\b/i;

/** Words a where-question may carry besides the names it asks about. */
const FILLER = new Set([
  "where", "is", "are", "s", "the", "a", "an", "defined", "declared", "implemented", "located", "live", "lives",
  "living", "define", "declare", "definition", "definitions", "of", "for", "in", "which", "file", "files",
  "defines", "declares", "has", "contains", "find", "can", "i", "we", "do", "locate", "and", "or", "function",
  "functions", "method", "methods", "class", "classes", "type", "types", "interface", "interfaces", "const",
  "constant", "variable", "enum", "struct", "trait", "symbol", "symbols", "codebase", "repo", "code", "this",
  "our", "please", "hey", "ok", "so", "at", "now", "exactly",
]);

/**
 * The identifiers a pure where-question asks about, or null when the request is not one
 * (it asks for something else too, or names nothing).
 */
export function whereDefinedTargets(request: string): string[] | null {
  const text = (request ?? "").trim();
  if (!text || text.length > MAX_QUESTION_CHARS || text.includes("\n") || !WHERE_DEFINED_LEAD.test(text)) return null;
  const names: string[] = [];
  // A plain lowercase word ("router", "config") is English as often as it is code, so a
  // name must be marked as code: backticked, or shaped like one (a capital, `_`, `$`).
  const ticked = new Set([...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.split(".").pop() ?? ""));
  // Strip punctuation a question wraps a name in; keep identifier characters and dots.
  for (const raw of text.replace(/[`'"?!,;:()]/g, " ").split(/\s+/)) {
    if (!raw) continue;
    const word = raw.replace(/^\.+|\.+$/g, "");
    if (!word) continue;
    if (FILLER.has(word.toLowerCase())) continue;
    // `a.b.c` asks for c. Anything that is not identifier-shaped means this is not a lookup.
    const last = word.split(".").pop() ?? "";
    if (!/^[A-Za-z_$][\w$]*$/.test(last)) return null;
    if (!ticked.has(last) && !/[A-Z_$]/.test(last)) return null;
    if (!names.includes(last)) names.push(last);
  }
  return names.length > 0 && names.length <= 4 ? names : null;
}

function location(m: SymbolMatch): string {
  return `- ${m.path}:${m.line} — ${m.kind} \`${m.name}\`${m.exported ? " (exported)" : ""}`;
}

/**
 * The model-free answer to a where-question, or null when the request is not one or any
 * identifier has no exact definition in the index.
 */
export async function answerWhereDefined(
  request: string,
  findSymbol: (name: string) => Promise<SymbolFindResult>,
): Promise<string | null> {
  const targets = whereDefinedTargets(request);
  if (!targets) return null;
  const sections: string[] = [];
  for (const name of targets) {
    let r: SymbolFindResult;
    try {
      r = await findSymbol(name);
    } catch {
      return null;
    }
    if (!r.ok) return null;
    const exact = (r.matches ?? []).filter((m) => m.name === name && m.kind !== "heading");
    if (exact.length === 0) return null;
    const shown = exact.slice(0, MAX_LOCATIONS).map(location);
    const more = exact.length - shown.length;
    sections.push([
      `\`${name}\` is defined ${exact.length === 1 ? "at" : "in"}:`,
      ...shown,
      ...(more > 0 ? [`- … and ${more} more`] : []),
    ].join("\n"));
  }
  return `${sections.join("\n\n")}\n\n_Answered from the workspace symbol index — no model call._`;
}
