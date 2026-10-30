/**
 * Lexical scan for writes to `executions.status`, shared by `check-execution-landing.mjs` and its self-test.
 *
 * The status of an execution moves in exactly two places: `ExecutionRepository` (`land` for a terminal status, the guarded `update`
 * for a non-terminal one) and the reaper's own conditional batch UPDATE. Anything else is a second writer that can resurrect or
 * overwrite a run another writer already settled. The scan is VALUE-AGNOSTIC on purpose: `'paused'` written without a non-terminal
 * predicate clobbered a cancelled row just as surely as `'failed'` would, so it is the write to the column that is flagged, not the
 * literal assigned to it.
 *
 * Shapes recognised (comments are blanked first, so prose that mentions them never matches - and a `//` inside a string, a template
 * literal or a regex literal is NOT a comment):
 *   - drizzle UPDATE: `update(<table>)` followed by a `.set(...)` whose object (nested braces, conditional spreads and all) carries a
 *     `status` key - plain, quoted, computed, shorthand - or spreads ANYTHING that is not provably an object literal (`...patch`,
 *     `...(patch)`, `...(cond ? x : {})`, at any spread depth), or has a computed key that is not provably another column
 *     (`[col]: v`, `[a + b]: v`), or is not an object literal at all;
 *   - drizzle UPSERT: `insert(<table>)...onConflictDoUpdate({ ..., set: { ... } })`, the `set` held to the same rules;
 *   - a drizzle builder HELD IN A VARIABLE: `const q = db.update(executions); await q.set({ status })` - every later `.set(...)` on a
 *     variable bound to an `update(<table>)` that has not been `.set()` yet is held to the same rules, within the block the variable
 *     was declared in and up to its next re-declaration / reassignment (another binding of the same name is not this builder);
 *   - a generic call: `update<Row>(executions)`, `.set<Row>({ ... })`;
 *   - raw SQL, including `sql``` templates: `UPDATE [ONLY] [schema.]<table> [AS alias] SET ... status =`, and the upsert
 *     `INSERT INTO <table> ... ON CONFLICT ... DO UPDATE SET ... status =`; the column plain, quoted (`"status"`), interpolated
 *     (`${executions.status}`, `${sql.identifier('status')}`) or in a tuple (`SET (status, x) = ...`). In the SET list, any
 *     INTERPOLATED assignment target that is not provably another column is flagged too: `${sql.identifier(col)}`, `${sql.raw(x)}`,
 *     `${setClause}` - only `${executions.<col>}` and `${sql.identifier('<col>')}` / `${sql.raw('<col>')}` with a literal column that
 *     is not `status` pass.
 *   `<table>` is the table however its argument spells it: `executions`, `executionsTable`, `schema.executions`, `schema['executions']`,
 *   `(executions)`, `executions as any`, `executions!`, and every simple const / import-as / destructure-rename alias of it in the same file
 *   (`const t = executions`, `= schema.executions`, `= schema['executions']`, `import { executions as runs }`, and a DESTRUCTURE
 *   `const { executions: runs } = schema`, an assignment `({ executions: runs } = schema)` and a parameter `function f({ executions: t })` -
 *   an object literal `{ executions: counts }` or a call argument is not an alias); the same name set drives the raw SQL patterns
 *   (`executionLandingRawSql.mjs`). `update` / `insert` / `set` may be spelled with bracket access (`db['update'](executions)`, `['set']({...})`).
 *
 * KNOWN LIMITS (lexical scan; each is pinned in `executionLandingGuard.test.ts` as documented-unflagged):
 *   - a table that reaches `update(table)` as a FUNCTION PARAMETER (or through any other value this pass cannot resolve to the
 *     `executions` table) is invisible - it is flagged only when `table` is a resolvable alias;
 *   - raw SQL assembled by STRING CONCATENATION (`'UPDATE exec' + 'utions SET sta' + 'tus = 1'`): the statement never appears whole;
 *   - a `;` INSIDE a SQL string literal ends the statement for the raw patterns (`SET note = 'a;b', status = 'x'`): what follows it
 *     is not seen;
 *   - a GETTER key (`set({ get status() { ... } })`) is not a `status` key to the key patterns;
 *   - a NESTED destructure pattern outside a declaration (`({ db: { executions: t } } = ctx)`), and a function parameter that SHADOWS a
 *     stored builder's name in a nested function (the nested uses are read as the outer builder's);
 *   - a builder passed through a function or a field (`this.q = db.update(executions)`, `run(db.update(executions))`) is only followed
 *     when it is bound to a plain variable.
 * Pass the table by name and write the status through `ExecutionRepository`: the guard is a net, not a proof.
 */

import { scanRawSql } from './executionLandingRawSql.mjs';

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'delete', 'throw', 'new', 'instanceof', 'yield', 'await']);

/** Can a `/` at `i` open a regex literal (rather than divide)? Decided by the last significant token before it. */
function regexMayStart(text, last) {
  if (last < 0) return true;
  const c = text[last];
  if (/[\w$]/.test(c)) {
    let from = last;
    while (from > 0 && /[\w$]/.test(text[from - 1])) from -= 1;
    return REGEX_KEYWORDS.has(text.slice(from, last + 1));
  }
  return !')]}'.includes(c) && c !== '"' && c !== "'" && c !== '`';
}

/** Index just past the regex literal opening at `i` (flags are plain code afterwards), or `i` when it does not close on its line. */
function pastRegex(text, i) {
  let inClass = false;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\n') return i;
    if (c === '\\') j += 1;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j + 1;
  }
  return i;
}

/**
 * Blank `/* *\/` and `//` comments (length-preserving, so offsets still point into the original). A real tokenizer pass: a `//` or
 * `/*` inside a '...' / "..." string, a regex literal (`/a\/\//`) or a template literal (its `${}` holes are code again) is text, not
 * a comment.
 */
function blankComments(text) {
  const out = text.split('');
  const blankTo = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  const holes = []; // brace depth at which each open `${` hole resumes its template
  let mode = 'code'; // 'code' or the quote that opened the string being read
  let depth = 0;
  let last = -1; // the last significant code character (what decides whether a `/` opens a regex)
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (mode === 'code') {
      if (c === '/' && text[i + 1] === '/') { const end = text.indexOf('\n', i); const to = end < 0 ? text.length : end; blankTo(i, to); i = to; continue; }
      if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); const to = end < 0 ? text.length : end + 2; blankTo(i, to); i = to; continue; }
      if (c === '/' && regexMayStart(text, last)) {
        const to = pastRegex(text, i);
        if (to !== i) { last = to - 1; i = to; continue; }
      }
      if (c === '"' || c === "'" || c === '`') mode = c;
      else if (c === '{') depth += 1;
      else if (c === '}') { if (holes.length > 0 && holes[holes.length - 1] === depth) { holes.pop(); mode = '`'; } else depth -= 1; }
      if (!/\s/.test(c)) last = i;
      i += 1;
    } else if (c === '\\') {
      i += 2;
    } else if (mode === '`' && c === '$' && text[i + 1] === '{') {
      holes.push(depth);
      mode = 'code';
      last = i + 1;
      i += 2;
    } else {
      if (c === mode) { mode = 'code'; last = i; }
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

/** Index of the paren closing the one at `open`, skipping string literals; -1 when unbalanced. */
function closeParen(text, open) {
  const close = walk(text.slice(open), (_i, c, d) => c === ')' && d === 0);
  return close < 0 ? -1 : open + close;
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

/**
 * True when an object literal has a computed key `[expr]` directly inside its braces that is not provably some OTHER column: a plain
 * string literal that is not `status` is provably another column; `'status'` and a `.status` member are the status column itself
 * (flagged by STATUS_KEY); anything else (`[col]`, `[a + b]`, `[k]`) could be either, so it is opaque.
 */
function hasOpaqueComputedKey(obj) {
  let opaque = false;
  walk(obj, (i, c, d) => {
    if (d !== 1 || c !== '[') return false;
    const before = obj.slice(0, i).trimEnd().slice(-1);
    if (before !== '{' && before !== ',') return false; // a value (`k: [..]`) or a spread operand, not a key
    const close = walk(obj.slice(i), (_j, ch, dd) => ch === ']' && dd === 0);
    const expr = (close < 0 ? obj.slice(i + 1) : obj.slice(i + 1, i + close)).trim();
    const literal = /^(['"`])([^'"`\\$]*)\1$/.exec(expr);
    if (literal ? literal[2] !== 'status' : false) return false;
    if (literal || /(?:^|\.)status\b/.test(expr)) return false; // the status column: STATUS_KEY flags it
    opaque = true;
    return true;
  });
  return opaque;
}

/** The value of property `name` directly inside object literal `obj` (up to the next top-level comma), or null when it has none. */
function propertyValue(obj, name) {
  let value = null;
  walk(obj, (i, _c, d) => {
    if (d !== 1 || !obj.startsWith(name, i) || /[\w$]/.test(obj[i - 1] ?? '') || /[\w$]/.test(obj[i + name.length] ?? '')) return false;
    if (!['{', ','].includes(obj.slice(0, i).trimEnd().slice(-1))) return false;
    const rest = obj.slice(i + name.length);
    const colon = /^\s*:/.exec(rest);
    if (!colon) return false;
    const after = rest.slice(colon[0].length);
    const end = walk(after, (_j, ch, depth) => depth < 0 || (depth === 0 && ch === ','));
    value = end < 0 ? after.slice(0, after.lastIndexOf('}')) : after.slice(0, end);
    return true;
  });
  return value;
}

/**
 * The names a destructure PATTERN that is not a declaration binds the table to: an assignment `({ executions: runs } = schema)` and a
 * parameter `function f({ executions: t })` / `({ executions: t }) =>` / `catch ({ executions: t })`. A `{ executions: x }` that is a
 * call argument or an object literal is a value, not a pattern, and is not an alias.
 */
function patternAliases(text, target) {
  const out = [];
  for (const m of text.matchAll(new RegExp(`\\{[^{}]*?\\b(?:${target})\\s*:\\s*([\\w$]+)\\s*(?=[,}])[^{}]*\\}`, 'g'))) {
    const after = text.slice(m.index + m[0].length);
    const close = walk(after, (_i, c, d) => d < 0 && c === ')');
    const parameter = close >= 0 && /^\s*(?::[^={};]*)?(?:=>|\{)/.test(after.slice(close + 1));
    if (/^\s*=(?![=>])/.test(after) || parameter) out.push(m[1]);
  }
  return out;
}

/** The names the `executions` table goes by in this file: itself, its repository alias, and every simple const / import / destructure alias. */
function executionTableNames(text) {
  const names = new Set(['executions', 'executionsTable']);
  const escaped = () => [...names].map((n) => n.replace(/\$/g, '\\$')).join('|');
  for (let grew = true; grew;) {
    grew = false;
    const target = escaped();
    const aliases = [
      // `const t = executions` / `= schema.executions` / `= schema['executions']`
      new RegExp(`\\b(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*(?:[\\w$]+\\.)*(?:${target}|[\\w$]+\\s*\\[\\s*['"\`](?:${target})['"\`]\\s*\\])\\s*(?=[;,\\n)]|$)`, 'g'),
      new RegExp(`\\b(?:${target})\\s+as\\s+([\\w$]+)`, 'g'),
      // a DESTRUCTURE rename (`const { executions: runs } = schema`) - an object literal `{ executions: counts }` is not an alias
      new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*?\\b(?:${target})\\s*:\\s*([\\w$]+)\\s*(?=[,}])`, 'g'),
    ];
    for (const re of aliases) for (const m of text.matchAll(re)) if (!names.has(m[1])) { names.add(m[1]); grew = true; }
    for (const alias of patternAliases(text, target)) if (!names.has(alias)) { names.add(alias); grew = true; }
  }
  return [...names].map((n) => n.replace(/\$/g, '\\$')).join('|');
}

// A `status` key (plain / quoted / computed) or shorthand inside the set object, at any brace depth.
const STATUS_KEY = /(?:[{,(]\s*|\n\s*)(?:status|'status'|"status")\s*[:,}]|\[\s*(?:[\w$]+\.)*status\b|\[\s*['"`]status['"`]\s*\]|['"`]status['"`]\s*:/;
/** What a write's object argument does wrong, as scan hits: not a literal, a `status` key, an opaque computed key or spread. */
function objectFindings(arg, where) {
  const literals = literalObjects(arg);
  const snippet = arg.trim().slice(0, 120);
  if (!literals) return [{ kind: `drizzle: non-literal ${where} argument`, snippet: snippet.slice(0, 80) }];
  if (STATUS_KEY.test(arg)) return [{ kind: `drizzle: status in ${where}`, snippet }];
  if (literals.some(hasOpaqueComputedKey)) return [{ kind: `drizzle: opaque computed key in ${where}`, snippet }];
  if (literals.some(hasOpaqueSpread)) return [{ kind: `drizzle: opaque spread in ${where}`, snippet }];
  return [];
}

/** The calls chained on from index `from` (`.where(..).set(..)`), each `{ name, args }`, stopping at the first thing that is not one. */
function chainedCalls(text, from) {
  const calls = [];
  // `.set(`, `['set'](` and the generic `.set<T>(`
  const next = /\s*(?:\??\.\s*([\w$]+)|\[\s*['"`]([\w$]+)['"`]\s*\])\s*(?:<[^()]*>\s*)?\(/y;
  for (let pos = from; ;) {
    next.lastIndex = pos;
    const m = next.exec(text);
    if (!m) return calls;
    const open = m.index + m[0].length - 1;
    const close = closeParen(text, open);
    if (close < 0) return calls;
    calls.push({ name: m[1] ?? m[2], args: text.slice(open + 1, close) });
    pos = close + 1;
  }
}

/**
 * The variable a drizzle builder is STORED in: `const q = db.update(executions);` / `q = this.db.update(executions).where(w);` - the
 * text just before the `update` of the call at `at` is `<name> =` after an optional receiver chain. null when the call is not
 * the right-hand side of an assignment.
 */
function storedBuilder(text, at) {
  const before = text.slice(Math.max(0, at - 160), at).replace(/(?:[\w$]+(?:\s*!)?\s*\??\.\s*)*[\w$]*$/, '');
  return /(?:^|[\s;{}(])([\w$]+)\s*(?::[^=;]+)?=\s*$/.exec(before)?.[1] ?? null;
}

/**
 * The text a stored builder `name` (regex-escaped) is the update builder in: from `from` to the close of the block it was declared in,
 * or to the next re-declaration / reassignment of the same name (which binds it to something else) - whichever comes first. Only a
 * rebind at depth 0 of that block counts: the same name inside a nested function / arrow body or a `{..}` / `[..]` destructure
 * pattern is another binding (or a default value), not this one. A second variable of the same name elsewhere in the file is a
 * different binding and is not this builder.
 */
function builderScope(text, from, name) {
  const blockEnd = walk(text.slice(from), (_i, c, d) => d < 0 && CLOSE.includes(c));
  const block = blockEnd < 0 ? text.slice(from) : text.slice(from, from + blockEnd);
  const rebind = new RegExp(`\\b(?:const|let|var)\\s+${name}(?![\\w$])|(?<![\\w$.])${name}\\s*=(?![=>])`, 'y');
  const at = walk(block, (i, _c, d) => {
    if (d !== 0) return false;
    rebind.lastIndex = i;
    return rebind.test(block);
  });
  return at < 0 ? block : block.slice(0, at);
}

/**
 * Every status write to `executions` in one file's text, as `{ kind, snippet }` (snippet = the offending statement, for the per-site
 * allow-list and the report).
 */
export function scanExecutionStatusWrites(source) {
  const text = blankComments(source);
  const found = [];
  const names = executionTableNames(text);
  // `<table>` as the argument of update(...) / insert(...): the table's name anywhere in it, however it is dressed
  // (`executions as any`, `(executions)`, `executions!`, `schema['executions']`).
  const tableToken = new RegExp(`(?<![\\w$])(?:${names})(?![\\w$])`);
  const builders = []; // `{ name, from }`: a variable bound to an update(<executions>) whose .set() is called later
  // `update(` / `insert(`, and the bracket-access spelling `db['update'](`.
  for (const call of text.matchAll(/(?:\[\s*['"`](update|insert)['"`]\s*\]|\b(update|insert))\s*(?:<[^()]*>\s*)?\(/g)) {
    const kind = call[1] ?? call[2];
    const open = call.index + call[0].length - 1;
    const close = closeParen(text, open);
    if (close < 0 || !tableToken.test(text.slice(open + 1, close))) continue;
    const chain = chainedCalls(text, close + 1);
    for (const { name, args } of chain) {
      if (kind === 'update' && name === 'set') found.push(...objectFindings(args, '.set()'));
      if (kind === 'insert' && name === 'onConflictDoUpdate') {
        const outer = literalObjects(args);
        const set = outer ? propertyValue(args, 'set') : null;
        if (!outer || set === null || outer.some(hasOpaqueSpread)) found.push({ kind: 'drizzle: non-literal onConflictDoUpdate set', snippet: args.trim().slice(0, 80) });
        else found.push(...objectFindings(set, 'onConflictDoUpdate set'));
      }
    }
    // A builder held in a variable (`const q = db.update(executions); await q.set({ status })`): every later `.set(...)` on that
    // variable is the write.
    const holder = kind === 'update' && !chain.some((c) => c.name === 'set') ? storedBuilder(text, call.index) : null;
    if (holder) builders.push({ name: holder, from: close + 1 });
  }
  for (const { name, from } of builders) {
    const id = name.replace(/\$/g, '\\$');
    for (const use of builderScope(text, from, id).matchAll(new RegExp(`(?<![\\w$.])${id}(?![\\w$])`, 'g'))) {
      const set = chainedCalls(text, from + use.index + use[0].length).find((c) => c.name === 'set');
      if (set) found.push(...objectFindings(set.args, '.set()'));
    }
  }
  found.push(...scanRawSql(text, names));
  return found;
}
