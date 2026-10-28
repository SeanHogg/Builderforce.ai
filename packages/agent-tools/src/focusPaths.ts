/**
 * The FILES a piece of text is about (PRD 35 E2, PRD 38 §4.10) — the paths a sentence
 * names ("update docs/specs/35-prd.md", "look at `clients/vscode/src/bfApi.ts:584`").
 *
 * ONE extractor for every runtime: the VS Code context pack inlines what a request names
 * before turn 1, and the cloud run-end memory anchors a durable fact to the files it names
 * so the fact joins the knowledge graph and can go stale. Both read paths with this rule.
 *
 * Pure and node-builtin-free: string in, candidate paths out. Which of them exist is the
 * caller's question (the VS Code half that resolves them on disk stays beside its loader).
 */

/** Paths taken from one text — a sentence naming more is a list, not a focus. */
export const MAX_FOCUS_PATHS = 8;

/** Wrapping punctuation a path is quoted or listed with. */
const WRAP = /^[`'"(<[{*]+|[`'")>\]},;!?*]+$/g;
/** A trailing `:12`, `:12:4`, `#L12` or `#L12-L40` line reference. */
const LINE_REF = /(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/;
/** A file name with an extension: `bfApi.ts`, `35-prd.md`, `package.json`. */
const HAS_EXTENSION = /(?:^|[\\/])[\w.@+-]*\w\.[A-Za-z][A-Za-z0-9]{0,7}$/;
/** Characters a workspace path is made of. Anything else means "not a path". */
const PATH_CHARS = /^[\w.@+\-\\/:~]+$/;

function clean(token: string): string {
  let t = token;
  // Until stable: "(README.md)." is a bracket, then a full stop, then the path.
  for (let i = 0; i < 4; i += 1) {
    // A sentence's full stop or a list's colon: "see docs/a.md." / "files: a.ts:".
    const next = t.replace(WRAP, "").replace(/[.:]+$/, "");
    if (next === t) break;
    t = next;
  }
  return t.replace(LINE_REF, "");
}

/** One token, if it reads as a workspace path. URLs, ids and plain words are not. */
export function asPathToken(raw: string): string | undefined {
  const t = clean(raw.trim());
  if (!t || t.length > 260 || t.includes("://") || !PATH_CHARS.test(t)) return undefined;
  if (/^[\d.:]+$/.test(t)) return undefined; // a version or a time, not a file
  const slashed = /[\\/]/.test(t) && /\w/.test(t.replace(/^[A-Za-z]:/, ""));
  if (!slashed && !HAS_EXTENSION.test(t)) return undefined;
  // `e.g.`, `i.e.`, `v1.2` — an extension of letters after a word, with no slash, must
  // still look like a file name.
  if (!slashed && /^(?:e\.g|i\.e|etc|vs)$/i.test(t)) return undefined;
  return t;
}

/** The candidate paths named in `text`, first-mentioned first, deduped, capped. */
export function extractFocusPaths(text: string | null | undefined, max: number = MAX_FOCUS_PATHS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? "").split(/[\s,]+/)) {
    const p = asPathToken(raw);
    if (!p) continue;
    const key = p.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
