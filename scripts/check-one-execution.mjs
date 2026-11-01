/**
 * check:one-execution — PRD 35 §3.3, a RATCHET.
 *
 * The whole point of the one-agent-one-kernel split is that `runAgent` (`packages/agent-run/src/runAgent.ts`) is the ONLY thing that
 * drives `runAgentLoop` (`@builderforce/agent-loop`), and `packages/agent-run` the only place run policy is composed. §3.3's
 * done-check: nothing outside `packages/agent-run` imports `runAgentLoop` or any `policy/*` module. This guard scans every project's
 * source for both.
 *
 * It reads the AST, not text, so it sees every way a module is reached and none that only look like one: `import … from`, `import type`,
 * `export * from`, `export { runAgentLoop } from`, `import x = require()`, a dynamic `import()`, a `require()`, a relative path that walks
 * into `packages/agent-loop` or `packages/agent-run/src/policy`, and the compact `import{x}from'y'` spelling. A comment or a string
 * naming `runAgentLoop` is not an import. A module reached whole (`export *`, a namespace import, a dynamic import or a `require()` that
 * is not destructured into names that exclude `runAgentLoop`) counts as importing it, because it carries `runAgentLoop` with it.
 * Test files are excluded (a test drives the loop directly), as is the kernel's own package. Inside `packages/agent-run` the rule is
 * tighter: only `src/runAgent.ts` reaches the kernel's loop; any other file there is a second driver.
 *
 * It exits 1 on a kernel importer that is not in BASELINE, on any policy reach-in from outside the package, on a second kernel driver
 * inside `packages/agent-run`, and on a BASELINE entry whose file no longer imports the kernel (a slack entry would let a new
 * importer in at that path). BASELINE can only shrink: it holds the one importer that still waits on the deletion of the Brain's old
 * loop (`brain-embedded/src/runStore/runLoop.ts`). Pass `--enforce` for the empty-allowlist verdict: every importer fails.
 */
import { fileURLToPath } from 'node:url';
import { dirname, posix, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { collectSourceFiles, loadTypeScript, toPosix } from './lib/moduleImports.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENFORCE = process.argv.includes('--enforce');

// Every project whose source could host a second loop or reach into the agent's policy.
const ROOTS = [
  'packages', 'brain-embedded/src', 'api/src', 'api/container', 'api/scripts',
  'agent-runtime/src', 'agent-runtime/extensions', 'agent-runtime/packages', 'agent-runtime/ui',
  'clients/vscode/src', 'clients/vscode/webview/src', 'clients/vscode/harness', 'clients/chrome/src', 'frontend/src',
];
const OWN = ['packages/agent-loop/', 'packages/agent-run/'];
const AGENT_RUN = 'packages/agent-run/';
/** The ONE file inside the agent that drives the kernel. */
const THE_DRIVER = 'packages/agent-run/src/runAgent.ts';
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const KERNEL_NAME = 'runAgentLoop';

/** Today's only kernel importer outside the one agent; it goes when the Brain's old loop is deleted. The list only ever shrinks. */
const BASELINE = [
  'brain-embedded/src/runStore/runLoop.ts',
];

const ts = loadTypeScript(repoRoot);

/** Does `specifier`, imported by repo-relative `file`, name the kernel package (by package name, by alias path or by relative walk)? */
function isKernel(specifier, file) {
  if (specifier === '@builderforce/agent-loop' || specifier.startsWith('@builderforce/agent-loop/')) return true;
  return /(^|\/)packages\/agent-loop(\/|$)/.test(resolveTarget(specifier, file));
}

/** Does it name a `policy/*` module of the agent (by package subpath, alias path or relative walk)? */
function reachesPolicy(specifier, file) {
  if (/^@builderforce\/agent-run\/.*\bpolicy\b/.test(specifier)) return true;
  return /(^|\/)agent-run\/src\/policy(\/|$)/.test(resolveTarget(specifier, file));
}

/** A relative specifier made repo-relative, so `../../../packages/agent-loop/src/loop` and `@x/../packages/…` read the same. */
function resolveTarget(specifier, file) {
  if (!specifier.startsWith('.')) return specifier;
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

/** The names a destructuring pattern takes from a module, or null when the module is not destructured into names. */
function destructuredNames(node) {
  // `const { a, b } = await import('x')` / `= require('x')`: the call's parent chain is [await] -> VariableDeclaration.
  let parent = node.parent;
  if (parent && ts.isAwaitExpression(parent)) parent = parent.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)) {
    return parent.name.elements.map((e) => (e.propertyName ?? e.name).getText());
  }
  return null;
}

/**
 * Every module reach in one file: `{ specifier, names }`, where `names` is the list of names taken from the module, or null when the
 * whole module is taken (a namespace import, `export *`, a require or a dynamic import not destructured).
 */
function moduleReaches(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const reaches = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      let names = [];
      if (clause?.name) names.push('default');
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names = null;
      else if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.map((e) => (e.propertyName ?? e.name).text));
      reaches.push({ specifier: node.moduleSpecifier.text, names, typeOnly: clause?.isTypeOnly === true });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const names = clause && ts.isNamedExports(clause) ? clause.elements.map((e) => (e.propertyName ?? e.name).text) : null;
      reaches.push({ specifier: node.moduleSpecifier.text, names, typeOnly: node.isTypeOnly === true });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)) {
      reaches.push({ specifier: node.moduleReference.expression.text, names: null, typeOnly: node.isTypeOnly === true });
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(callee) && callee.text === 'require';
      const arg = node.arguments[0];
      if ((dynamic || required) && arg && ts.isStringLiteralLike(arg)) reaches.push({ specifier: arg.text, names: destructuredNames(node), typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reaches;
}

/** Does this reach bring `runAgentLoop` with it? Taken by name, or the whole module. A type-only import brings nothing at run time. */
const bringsKernel = (reach) => !reach.typeOnly && (reach.names === null || reach.names.includes(KERNEL_NAME));

/** @type {{ file: string; kind: 'kernel-loop' | 'inner-loop' | 'policy'; specifier: string }[]} */
const findings = [];
for (const root of ROOTS) {
  for (const absolute of collectSourceFiles(resolve(repoRoot, root))) {
    const rel = toPosix(absolute).replace(toPosix(repoRoot) + '/', '');
    if (TEST_FILE.test(rel)) continue;
    const text = readFileSync(absolute, 'utf8');
    // Cheap pre-filter: every route to the kernel or the policy names one of these in its specifier or its bindings.
    if (!text.includes('agent-loop') && !text.includes('agent-run') && !text.includes(KERNEL_NAME)) continue;
    const reaches = moduleReaches(rel, text);
    if (rel.startsWith(AGENT_RUN)) {
      // Inside the agent, policy imports are its own; only a second kernel driver counts.
      if (rel === THE_DRIVER) continue;
      for (const reach of reaches) if (isKernel(reach.specifier, rel) && bringsKernel(reach)) findings.push({ file: rel, kind: 'inner-loop', specifier: reach.specifier });
      continue;
    }
    if (OWN.some((own) => rel.startsWith(own))) continue;
    for (const reach of reaches) {
      if (isKernel(reach.specifier, rel) && bringsKernel(reach)) findings.push({ file: rel, kind: 'kernel-loop', specifier: reach.specifier });
      else if (!reach.typeOnly && reachesPolicy(reach.specifier, rel)) findings.push({ file: rel, kind: 'policy', specifier: reach.specifier });
    }
  }
}

const loopImporters = [...new Set(findings.filter((f) => f.kind === 'kernel-loop').map((f) => f.file))].sort();
const policyImporters = findings.filter((f) => f.kind === 'policy');
const innerImporters = [...new Set(findings.filter((f) => f.kind === 'inner-loop').map((f) => f.file))].sort();
const extra = loopImporters.filter((file) => !BASELINE.includes(file));
const gone = BASELINE.filter((file) => !loopImporters.includes(file));

console.log(`check:one-execution (${ENFORCE ? 'enforce, empty allowlist' : 'ratchet'})`);
console.log(`  Importers of runAgentLoop outside @builderforce/agent-loop and @builderforce/agent-run (${loopImporters.length}):`);
for (const file of loopImporters) console.log(`    - ${file}${BASELINE.includes(file) ? '' : '   (NEW - not in BASELINE)'}`);
if (policyImporters.length > 0) {
  console.log(`  Imports of agent-run policy/* from outside the package (${policyImporters.length}) - never allowed:`);
  for (const f of policyImporters) console.log(`    + ${f.file} -> ${f.specifier}`);
}
if (innerImporters.length > 0) {
  console.log(`  Importers of runAgentLoop inside packages/agent-run other than ${THE_DRIVER} (${innerImporters.length}) - never allowed:`);
  for (const file of innerImporters) console.log(`    + ${file}`);
}
if (gone.length > 0) {
  console.log(`  Baseline entries whose file no longer imports the kernel - drop them from BASELINE (${gone.length}):`);
  for (const file of gone) console.log(`    - ${file}`);
}
console.log('  §3.3: the one execution path is runAgent (packages/agent-run/src/runAgent.ts).');

const kernelViolations = ENFORCE ? loopImporters.length : extra.length;
const violations = kernelViolations + policyImporters.length + innerImporters.length + gone.length;
if (violations > 0) {
  console.log(`  FAIL ${violations} problem(s): ${kernelViolations} kernel, ${policyImporters.length} policy reach-in, ${innerImporters.length} second driver in agent-run, ${gone.length} stale baseline entr${gone.length === 1 ? 'y' : 'ies'}.`);
  process.exit(1);
}
console.log(`  PASS No importer outside the baseline (${loopImporters.length} of ${BASELINE.length} baseline file(s) remain).`);
process.exit(0);
