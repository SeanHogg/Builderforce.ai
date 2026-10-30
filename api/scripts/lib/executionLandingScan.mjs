/**
 * Lexical scan for writes to `executions.status`, shared by `check-execution-landing.mjs` and its self-test.
 *
 * The status of an execution moves in exactly two places: `ExecutionRepository` (`land` for a terminal status, the guarded `update`
 * for a non-terminal one) and the reaper's own conditional batch UPDATE. Anything else is a second writer that can resurrect or
 * overwrite a run another writer already settled. The scan is VALUE-AGNOSTIC on purpose: `'paused'` written without a non-terminal
 * predicate clobbered a cancelled row just as surely as `'failed'` would, so it is the write to the column that is flagged, not the
 * literal assigned to it.
 *
 * Two shapes are recognised (comments are blanked first, so prose that mentions them never matches):
 *   - drizzle: `update(executions)` / `update(executionsTable)` / `update(schema.executions)` followed by a `.set(...)` whose object
 *     (nested braces, conditional spreads and all) carries a `status` key - plain, quoted, computed, shorthand - or spreads an unknown
 *     object, or is not an object literal at all (so cannot be proven to leave `status` alone);
 *   - raw SQL, including `sql``` templates: `UPDATE [schema.]executions [AS alias] SET ... status =`.
 */

/** Blank `/* *\/` and `//` comments (length-preserving, so offsets still point into the original). */
function blankComments(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])(\/\/.*)$/gm, (_m, lead, comment) => lead + blank(comment));
}

/** The text between the balanced parens opening at `open` (exclusive of them), skipping string literals; null when unbalanced. */
function balancedParens(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i += 1; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i += 1;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

const UPDATE_EXECUTIONS = /\bupdate\(\s*(?:[\w$]+\.)*executions(?:Table)?\s*\)\s*\.set\(/g;
// A `status` key (plain / quoted / computed) or shorthand inside the set object, at any brace depth.
const STATUS_KEY = /(?:[{,(]\s*|\n\s*)(?:status|'status'|"status")\s*[:,}]|\[\s*(?:[\w$]+\.)*status\b|\[\s*['"`]status['"`]\s*\]|['"`]status['"`]\s*:/;
// `...someIdentifier` spread directly in the set object: an object this scan cannot see into.
const OPAQUE_SPREAD = /\.\.\.\s*[\w$.]+\s*[,}]/;

/** The text of a set object with every nested `{}` / `()` group emptied: what sits at its own top level. */
function topLevelOf(arg) {
  let out = arg.trim();
  for (let prev = ''; prev !== out;) { prev = out; out = out.replace(/\{[^{}]*\}|\([^()]*\)/g, (m, offset) => (offset === 0 ? m : ' ')); }
  return out;
}
const RAW_SQL = /UPDATE\s+("?\w+"?\.)?"?executions"?(\s+(AS\s+)?\w+)?\s+SET[^;]*\bstatus\s*=/gi;

/**
 * Every status write to `executions` in one file's text, as `{ kind, snippet }` (snippet = the offending statement, for the per-site
 * allow-list and the report).
 */
export function scanExecutionStatusWrites(source) {
  const text = blankComments(source);
  const found = [];
  for (const m of text.matchAll(UPDATE_EXECUTIONS)) {
    const open = m.index + m[0].length - 1;
    const arg = balancedParens(text, open);
    if (arg === null) continue;
    const literal = arg.trim().startsWith('{');
    if (!literal) found.push({ kind: 'drizzle: non-literal .set() argument', snippet: arg.trim().slice(0, 80) });
    else if (STATUS_KEY.test(arg)) found.push({ kind: 'drizzle: status in .set()', snippet: arg.trim().slice(0, 120) });
    else if (OPAQUE_SPREAD.test(topLevelOf(arg))) found.push({ kind: 'drizzle: opaque spread in .set()', snippet: arg.trim().slice(0, 120) });
  }
  for (const raw of text.matchAll(RAW_SQL)) found.push({ kind: 'raw SQL: UPDATE executions SET status', snippet: raw[0].replace(/\s+/g, ' ').slice(0, 120) });
  return found;
}
