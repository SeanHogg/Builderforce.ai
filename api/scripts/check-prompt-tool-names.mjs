/**
 * check-prompt-tool-names — a prompt must name the tool THE MODEL WAS GIVEN.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * Every builtin tool is advertised to the model under `advertisedName(id)` —
 * `kanban.signoff` becomes `builtin_kanban_signoff`. A prompt that prints the raw catalog
 * id therefore hands the model a string that appears nowhere in its tool list.
 *
 * That failure is SILENT in both directions. The model does not error; it describes the
 * call it would like to make and finishes successfully. Nothing downstream can tell that
 * run apart from one that simply chose not to act.
 *
 * It has now shipped three times:
 *   • the manager's accountability framing named `manager.digest`, and the model replied
 *     "The tools required are manager.digest, manager.decisions…" instead of calling them;
 *   • `kanban/signoffRequest.ts` — the instruction EVERY reviewer and producer run on a
 *     lifecycle-managed board receives — said "call the `kanban.signoff` tool". Measured
 *     on project 11, 2026-07-28 (api 2026.7.170): **492 agent runs completed, 0 forward
 *     lane moves, 0 tickets finished**, 281 tickets stalled on `awaiting_signoff`, and 17
 *     slots classified `exhausted` for agents that had never been given a working way to
 *     record a verdict.
 *   • migration `0376_manager_chat.sql` — which wrote the SAME dead ids into every
 *     tenant's persisted Manager persona (`ide_agents.bio`). Fixing the TypeScript seed
 *     did NOT fix those rows (`provisionBuiltinAgents` skips a tenant that already has
 *     the agent), so the manager went on reciting them for a full release: project 11 /
 *     chat 86, 2026-07-28, api 2026.7.172 — 7 model turns, 102 tools advertised, ZERO
 *     tool calls. Repaired by 0379.
 *
 * The first fix was a unit test on one prompt. The second defect was in a different file,
 * so the test did not cover it. The third was not in TypeScript at all. This checks the
 * property everywhere instead — `src/**\/*.ts` AND `migrations/*.sql`.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * TypeScript: no STRING LITERAL that reads as prose may contain a catalog tool id unless
 * it also contains that tool's advertised name.
 *
 * SQL: a prose literal in a migration may name NO tool — not the catalog id, not the
 * advertised name. A migration writes DATA, and prompt data is never rewritten by a
 * deploy, so there is no tool name that stays correct in it. (The one exemption is the
 * NEEDLE argument of `replace()`: a repair migration must quote the dead text in order
 * to find it. See 0379.)
 *
 * Deliberately literal-only: doc comments discuss tool ids constantly and legitimately,
 * and only a string can reach a model. "Reads as prose" = contains a space, which
 * excludes the bare `'kanban.signoff'` constants, allowlist entries and Set members that
 * must keep the catalog id.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Roots scanned for TypeScript prompts.
 *
 * The FRONTEND is here for the same reason the SQL migrations are: the rule is about
 * text that reaches a model, and text that reaches a model is not confined to this
 * package. The Creation Canvas system prompt lives in
 * `frontend/src/lib/creationCanvasAi.ts` and is compiled into every Canvas turn — and
 * when this root was added it was naming four catalog ids (`creative.capabilities`,
 * `creative.compose`, `sales.workspace_get`, `meetings.schedule`) that appear nowhere in
 * the model's tool list, the fourth instance of this defect.
 */
const TS_ROOTS = [path.resolve('src'), path.resolve('..', 'frontend', 'src')].filter((dir) => fs.existsSync(dir));
const CATALOG_FILE = path.join('src', 'application', 'llm', 'builtinMcpService.ts');

const advertisedName = (tool) => `builtin_${tool.replace(/[^a-zA-Z0-9]+/g, '_')}`;

/** Every tool id in the builtin catalog, read from the catalog itself. */
function loadCatalogIds() {
  const text = fs.readFileSync(path.resolve(CATALOG_FILE), 'utf8');
  const ids = new Set();
  for (const m of text.matchAll(/\{\s*tool:\s*'([a-z0-9_]+\.[a-z0-9_]+)'/g)) ids.add(m[1]);
  return ids;
}

const CATALOG = loadCatalogIds();
if (CATALOG.size === 0) {
  console.error('check-prompt-tool-names: could not read any tool ids from the catalog — the parse is stale, not the code.');
  process.exit(1);
}

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(full);
  }
}
walk(sourceRoot);

const violations = [];
for (const filePath of files) {
  const rel = path.relative(process.cwd(), filePath);
  // The catalog defines the ids and the mapping; it is the one file that must name both.
  if (rel === CATALOG_FILE) continue;

  const sourceFile = ts.createSourceFile(
    filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );

  /**
   * Identifiers bound directly to a catalog id in this file — `const SIGNOFF_TOOL =
   * 'kanban.signoff'`. Interpolating one of these into a prompt is the same defect as
   * hand-typing it, and it is the form a careless refactor produces, so it is checked
   * too. (Verified by mutation: swapping `${SIGNOFF_TOOL_NAME}` back to `${SIGNOFF_TOOL}`
   * must fail this script, not only the unit tests.)
   */
  const catalogIdConsts = new Set();
  (function collect(node) {
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer && ts.isStringLiteral(node.initializer)
      && CATALOG.has(node.initializer.text)
    ) catalogIdConsts.add(node.name.text);
    ts.forEachChild(node, collect);
  })(sourceFile);

  /** Check one string's TEXT (comments are excluded by construction — this is a literal). */
  function check(node, text) {
    if (!text.includes(' ')) return; // a bare identifier/constant, not prose for a model
    for (const id of CATALOG) {
      if (!text.includes(id)) continue;
      if (text.includes(advertisedName(id))) continue; // names both — fine
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(
        `${rel}:${line + 1} a prompt string names the catalog id '${id}', which appears nowhere `
        + `in the model's tool list. Use advertisedName('${id}') — the model sees `
        + `'${advertisedName(id)}'.`,
      );
      return;
    }
  }

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      // Static spans first — a hand-typed id between substitutions is still a hand-typed id.
      const prose = node.head.text + node.templateSpans.map((s) => s.literal.text).join(' ');
      check(node, prose);
      // Then the substitutions: a prose template that interpolates a CATALOG-ID constant
      // is the same defect wearing a variable. `${SIGNOFF_TOOL_NAME}` — an advertised
      // name — is not in that set and passes.
      if (prose.includes(' ')) {
        for (const span of node.templateSpans) {
          if (!ts.isIdentifier(span.expression) || !catalogIdConsts.has(span.expression.text)) continue;
          const { line } = sourceFile.getLineAndCharacterOfPosition(span.expression.getStart(sourceFile));
          violations.push(
            `${rel}:${line + 1} a prompt string interpolates \`${span.expression.text}\`, which holds a `
            + 'catalog id the model was never given. Interpolate the advertised name instead '
            + `(e.g. advertisedName(${span.expression.text})).`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

// ---------------------------------------------------------------------------
// SQL MIGRATIONS — the persisted half of the same defect.
//
// A migration writes prompt TEXT into a row (`ide_agents.bio` is compiled straight into
// an agent's system prompt). Unlike code, that text is never revisited by a deploy, so a
// tool name in it is wrong forever the moment the catalog moves — which is exactly what
// 0376 did. Hence the stricter rule here: name no tool at all.
// ---------------------------------------------------------------------------

const MIGRATION_DIRS = ['migrations', 'transactional-migrations'];
const ADVERTISED = new Map([...CATALOG].map((id) => [advertisedName(id), id]));

/** Every single-quoted SQL literal with its offset, `''` escapes folded to `'`. */
function sqlLiterals(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "'") continue;
    const start = i;
    let value = '';
    i++;
    for (; i < text.length; i++) {
      if (text[i] !== "'") { value += text[i]; continue; }
      if (text[i + 1] === "'") { value += "'"; i++; continue; }
      break;
    }
    out.push({ start, end: i, value });
  }
  return out;
}

/** `-- line comments` blanked out (length-preserving, so literal offsets still line up).
 *  Comments discuss dead tool ids on purpose — this file's own header does. */
function stripSqlComments(text) {
  return text.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * Offsets spanned by the NEEDLE argument of every `replace(haystack, needle, repl)` call.
 *
 * A repair migration has to quote the defective text verbatim to match it; flagging that
 * would make the defect unfixable. Only argument 1 is exempt — the REPLACEMENT is new
 * prompt text and is held to the rule.
 */
function replaceNeedleRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(/\breplace\s*\(/gi)) {
    let depth = 1;
    let arg = 0;
    let argStart = m.index + m[0].length;
    for (let i = argStart; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === "'") { // skip the literal wholesale, quotes inside must not move `depth`
        for (i++; i < text.length; i++) {
          if (text[i] !== "'") continue;
          if (text[i + 1] === "'") { i++; continue; }
          break;
        }
        continue;
      }
      if (ch === '(') { depth++; continue; }
      if (ch === ')') { depth--; if (depth === 0 && arg === 1) ranges.push([argStart, i]); continue; }
      if (ch === ',' && depth === 1) {
        if (arg === 1) ranges.push([argStart, i]);
        arg++;
        argStart = i + 1;
      }
    }
  }
  return ranges;
}

/**
 * A literal used as a SEARCH PATTERN (`bio LIKE '%manager.digest%'`) rather than as data.
 * Same reasoning as the `replace()` needle: a repair migration must be able to FIND the
 * defective rows, and the guard clause that makes it idempotent is exactly that search.
 */
function isSearchPattern(text, start) {
  return /\b(?:i?like|similar\s+to)\s*$/i.test(text.slice(Math.max(0, start - 40), start));
}

const sqlFiles = [];
for (const dir of MIGRATION_DIRS) {
  const full = path.resolve(dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) {
    if (name.endsWith('.sql')) sqlFiles.push(path.join(full, name));
  }
}

for (const filePath of sqlFiles) {
  const rel = path.relative(process.cwd(), filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const text = stripSqlComments(raw);
  const exempt = replaceNeedleRanges(text);
  const lineOf = (offset) => text.slice(0, offset).split('\n').length;

  for (const literal of sqlLiterals(text)) {
    if (!literal.value.includes(' ')) continue; // an identifier or an enum value, not prose
    if (exempt.some(([from, to]) => literal.start >= from && literal.end <= to)) continue;
    if (isSearchPattern(text, literal.start)) continue;

    const id = [...CATALOG].find((t) => literal.value.includes(t));
    const advertised = [...ADVERTISED.keys()].find((name) => literal.value.includes(name));
    if (!id && !advertised) continue;
    violations.push(
      `${rel}:${lineOf(literal.start)} a migration writes prompt text naming the tool `
      + `'${id ?? advertised}'. Persisted prompt text is never rewritten by a deploy, so the `
      + 'name is wrong forever once the catalog moves (0376 → 0379). State the standard and '
      + 'let the prompt builder name the tool at reply time, against the list the model was '
      + 'actually given.',
    );
  }
}

if (violations.length > 0) {
  console.error('Prompts naming a tool the model was never given:\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\n${violations.length} violation(s). See api/scripts/check-prompt-tool-names.mjs for the rule.`);
  process.exit(1);
}
console.log(
  `check-prompt-tool-names: OK (${CATALOG.size} catalog tools, ${files.length} TS files, ${sqlFiles.length} SQL migrations)`,
);
