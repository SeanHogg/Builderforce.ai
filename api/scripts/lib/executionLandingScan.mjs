/**
 * Lexical scan for writes to `executions.status`, shared by `check-execution-landing.mjs` and its self-test.
 *
 * The status of an execution moves in exactly two places: `ExecutionRepository` (`land` for a terminal status, the guarded `update`
 * for a non-terminal one) and the reaper's own conditional batch UPDATE. Anything else is a second writer that can resurrect or
 * overwrite a run another writer already settled. The scan is VALUE-AGNOSTIC on purpose: `'paused'` written without a non-terminal
 * predicate clobbered a cancelled row just as surely as `'failed'` would, so it is the write to the column that is flagged, not the
 * literal assigned to it.
 *
 * Two shapes are recognised (comments are blanked first, so prose that mentions them never matches - and a `//` inside a string or
 * template literal is NOT a comment):
 *   - drizzle: `update(executions)` / `update(executionsTable)` / `update(schema.executions)` / `update(alias)` (a simple const alias,
 *     import-as or destructure-rename of the table in the same file) followed by a `.set(...)` whose object (nested braces, conditional
 *     spreads and all) carries a `status` key - plain, quoted, computed, shorthand - or spreads ANYTHING that is not provably an object
 *     literal (`...patch`, `...(patch)`, `...(cond ? x : {})`, at any spread depth), or is not an object literal at all;
 *   - raw SQL, including `sql``` templates: `UPDATE [schema.]executions|${executions} [AS alias] SET ... status =`, the column plain,
 *     quoted (`"status"`) or interpolated (`${executions.status}`).
 */

/**
 * Blank `/* *\/` and `//` comments (length-preserving, so offsets still point into the original). A real tokenizer pass: a `//` or
 * `/*` inside a '...' / "..." string or a template literal (its `${}` holes are code again) is text, not a comment.
 */
function blankComments(text) {
  const out = text.split('');
  const blankTo = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  const holes = []; // brace depth at which each open `${` hole resumes its template
  let mode = 'code'; // 'code' or the quote that opened the string being read
  let depth = 0;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (mode === 'code') {
      if (c === '/' && text[i + 1] === '/') { const end = text.indexOf('\n', i); const to = end < 0 ? text.length : end; blankTo(i, to); i = to; continue; }
      if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); const to = end < 0 ? text.length : end + 2; blankTo(i, to); i = to; continue; }
      if (c === '"' || c === "'" || c === '`') mode = c;
      else if (c === '{') depth += 1;
      else if (c === '}') { if (holes.length > 0 && holes[holes.length - 1] === depth) { holes.pop(); mode = '`'; } else depth -= 1; }
      i += 1;
    } else if (c === '\\') {
      i += 2;
    } else if (mode === '`' && c === '$' && text[i + 1] === '{') {
      holes.push(depth);
      mode = 'code';
      i += 2;
    } else {
      if (c === mode) mode = 'code';
      i += 1;
    }
  }
  return out.join('');
}

const OPEN = '([{';
const CLOSE = ')]}';

/** Index just past the string literal starting at `i`, or `i` when there is none there. */
function pastString(t, i) {
  const q = t[i];
  if (q !== '"' && q !== "'" && q !== '`') return i;
  let j = i + 1;
  while (j < t.length && t[j] !== q) j += t[j] === '\\' ? 2 : 1;
  return j + 1;
}

/**
 * Visit every character of `t` outside string literals with its bracket depth (an opening bracket is visited at the depth it sits
 * at, what it encloses one deeper; a closing one back at the outer depth, so a stray close reads -1). `visit` returns true to stop;
 * the result is the stopping index, or -1.
 */
function walk(t, visit) {
  let depth = 0;
  for (let i = 0; i < t.length;) {
    const j = pastString(t, i);
    if (j !== i) { i = j; continue; }
    const c = t[i];
    if (CLOSE.includes(c)) depth -= 1;
    if (visit(i, c, depth)) return i;
    if (OPEN.includes(c)) depth += 1;
    i += 1;
  }
  return -1;
}

/** The text between the balanced parens opening at `open` (exclusive of them), skipping string literals; null when unbalanced. */
function balancedParens(text, open) {
  const close = walk(text.slice(open), (_i, c, d) => c === ')' && d === 0);
  return close < 0 ? null : text.slice(open + 1, open + close);
}

/** `e` without the parens that wrap all of it. */
function stripParens(e) {
  let out = e.trim();
  while (out.startsWith('(') && walk(out, (_i, c, d) => c === ')' && d === 0) === out.length - 1) out = out.slice(1, -1).trim();
  return out;
}

/** The two branches of a top-level `cond ? a : b` (nested ternaries kept whole), or null when `e` is not one. */
function ternaryBranches(e) {
  let question = -1;
  let pending = 0;
  const colon = walk(e, (i, c, d) => {
    if (d !== 0) return false;
    if (c === '?' && e[i + 1] !== '.' && e[i + 1] !== '?' && e[i - 1] !== '?') { if (question < 0) question = i; else pending += 1; }
    else if (c === ':' && question >= 0) { if (pending === 0) return true; pending -= 1; }
    return false;
  });
  return question >= 0 && colon > question ? [e.slice(question + 1, colon), e.slice(colon + 1)] : null;
}

/**
 * The object literals `expr` is made of when it is PROVABLY one - `{ ... }`, parenthesised, or a ternary of such - else null (an
 * identifier, a call, `cond && x`, a member access: anything this scan cannot see into).
 */
function literalObjects(expr) {
  const e = stripParens(expr);
  if (e.startsWith('{')) return walk(e, (_i, c, d) => c === '}' && d === 0) === e.length - 1 ? [e] : null;
  const branches = ternaryBranches(e);
  if (!branches) return null;
  const left = literalObjects(branches[0]);
  const right = literalObjects(branches[1]);
  return left && right ? [...left, ...right] : null;
}

/**
 * True when an object literal spreads something opaque INTO ITSELF: a `...x` directly inside its braces whose operand is not provably
 * an object literal, or whose literal operand (the branches of a conditional spread included) does so in turn - at any depth of
 * spreading. A spread inside some other value (`payload: JSON.stringify({ ...p })`) is not spread into the object and is left alone.
 */
function hasOpaqueSpread(obj) {
  let opaque = false;
  walk(obj, (i, _c, d) => {
    if (d !== 1 || !obj.startsWith('...', i)) return false;
    const rest = obj.slice(i + 3);
    const end = walk(rest, (_j, c, depth) => depth < 0 || (depth === 0 && c === ','));
    const literals = literalObjects(end < 0 ? rest : rest.slice(0, end));
    if (!literals || literals.some(hasOpaqueSpread)) { opaque = true; return true; }
    return false;
  });
  return opaque;
}

/** The names the `executions` table goes by in this file: itself, its repository alias, and every simple const / import / destructure alias. */
function executionTableNames(text) {
  const names = new Set(['executions', 'executionsTable']);
  const escaped = () => [...names].map((n) => n.replace(/\$/g, '\\$')).join('|');
  for (let grew = true; grew;) {
    grew = false;
    const target = escaped();
    const aliases = [
      new RegExp(`\\b(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*(?:[\\w$]+\\.)*(?:${target})\\s*(?=[;,\\n)]|$)`, 'g'),
      new RegExp(`\\b(?:${target})\\s+as\\s+([\\w$]+)`, 'g'),
      new RegExp(`\\b(?:${target})\\s*:\\s*([\\w$]+)\\s*[,}]`, 'g'),
    ];
    for (const re of aliases) for (const m of text.matchAll(re)) if (!names.has(m[1])) { names.add(m[1]); grew = true; }
  }
  return [...names].map((n) => n.replace(/\$/g, '\\$')).join('|');
}

// A `status` key (plain / quoted / computed) or shorthand inside the set object, at any brace depth.
const STATUS_KEY = /(?:[{,(]\s*|\n\s*)(?:status|'status'|"status")\s*[:,}]|\[\s*(?:[\w$]+\.)*status\b|\[\s*['"`]status['"`]\s*\]|['"`]status['"`]\s*:/;
// `UPDATE [schema.]executions|${executions} [AS alias] SET ... status =` - the column plain, quoted or interpolated.
const RAW_SQL = /UPDATE\s+(?:"?\w+"?\.)?(?:"?executions"?|\$\{\s*(?:[\w$]+\.)*executions\s*\})(?:\s+(?:AS\s+)?"?\w+"?)?\s+SET[^;]*(?:\bstatus"?|"status"|\$\{[^}]*\.status\})\s*=/gi;

/**
 * Every status write to `executions` in one file's text, as `{ kind, snippet }` (snippet = the offending statement, for the per-site
 * allow-list and the report).
 */
export function scanExecutionStatusWrites(source) {
  const text = blankComments(source);
  const found = [];
  const updateExecutions = new RegExp(`\\bupdate\\(\\s*(?:[\\w$]+\\.)*(?:${executionTableNames(text)})\\s*\\)\\s*\\.set\\(`, 'g');
  for (const m of text.matchAll(updateExecutions)) {
    const open = m.index + m[0].length - 1;
    const arg = balancedParens(text, open);
    if (arg === null) continue;
    const literals = literalObjects(arg);
    if (!literals) found.push({ kind: 'drizzle: non-literal .set() argument', snippet: arg.trim().slice(0, 80) });
    else if (STATUS_KEY.test(arg)) found.push({ kind: 'drizzle: status in .set()', snippet: arg.trim().slice(0, 120) });
    else if (literals.some(hasOpaqueSpread)) found.push({ kind: 'drizzle: opaque spread in .set()', snippet: arg.trim().slice(0, 120) });
  }
  for (const raw of text.matchAll(RAW_SQL)) found.push({ kind: 'raw SQL: UPDATE executions SET status', snippet: raw[0].replace(/\s+/g, ' ').slice(0, 120) });
  return found;
}
