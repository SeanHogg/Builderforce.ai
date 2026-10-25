/**
 * The FILES a request is about (PRD 35 E2) — the paths the user named in the sentence
 * ("update docs/specs/35-prd.md", "look at `clients/vscode/src/bfApi.ts:584`"). The
 * context pack inlines or outlines each one before turn 1, so the run does not spend its
 * first turns finding and reading the document it was handed.
 *
 * Pure: string in, candidate paths out. Which of them exist is the loader's question.
 */

import * as path from "node:path";

/** Paths taken from one request — a sentence naming more is a list, not a focus. */
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

/**
 * Where a named path lives on disk, or undefined when it would escape the workspace
 * root. Relative paths resolve against the root; an absolute path must sit under it.
 */
export function resolveUnderRoot(root: string, candidate: string): string | undefined {
  if (!root) return undefined;
  const base = path.resolve(root);
  const abs = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(base, candidate);
  const rel = path.relative(base, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return abs;
}

/** The workspace-relative, forward-slash form a pack and a code map speak. */
export function workspaceRelative(root: string, abs: string): string {
  return path.relative(path.resolve(root), abs).split(path.sep).join("/");
}
