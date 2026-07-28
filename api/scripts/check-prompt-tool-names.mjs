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
 * It has now shipped twice:
 *   • the manager's accountability framing named `manager.digest`, and the model replied
 *     "The tools required are manager.digest, manager.decisions…" instead of calling them;
 *   • `kanban/signoffRequest.ts` — the instruction EVERY reviewer and producer run on a
 *     lifecycle-managed board receives — said "call the `kanban.signoff` tool". Measured
 *     on project 11, 2026-07-28 (api 2026.7.170): **492 agent runs completed, 0 forward
 *     lane moves, 0 tickets finished**, 281 tickets stalled on `awaiting_signoff`, and 17
 *     slots classified `exhausted` for agents that had never been given a working way to
 *     record a verdict.
 *
 * The first fix was a unit test on one prompt. The second defect was in a different file,
 * so the test did not cover it. This checks the property everywhere instead.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * No STRING LITERAL that reads as prose may contain a catalog tool id unless it also
 * contains that tool's advertised name.
 *
 * Deliberately AST-based and literal-only: doc comments discuss tool ids constantly and
 * legitimately, and only a string can reach a model. "Reads as prose" = contains a space,
 * which excludes the bare `'kanban.signoff'` constants, allowlist entries and Set members
 * that must keep the catalog id.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const sourceRoot = path.resolve('src');
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

if (violations.length > 0) {
  console.error('Prompts naming a tool the model was never given:\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\n${violations.length} violation(s). See api/scripts/check-prompt-tool-names.mjs for the rule.`);
  process.exit(1);
}
console.log(`check-prompt-tool-names: OK (${CATALOG.size} catalog tools, ${files.length} files)`);
