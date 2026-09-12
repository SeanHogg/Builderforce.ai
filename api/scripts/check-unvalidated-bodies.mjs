/**
 * Unvalidated-body guard — a per-file ratchet over raw `c.req.json` reads.
 *
 * `c.req.json<T>()` is a type assertion: the `<T>` is a promise the caller makes
 * to itself and the request never has to keep. 750 of them across 159 route files
 * meant a body shaped wrong reached the handler's own code and died as a 500 —
 * reported as a defect — when it was a 400. `presentation/routes/requestBody.ts`
 * (`parseBody`, `parseQuery`) is the one validated read.
 *
 * Migrating every site is not one pass, so this is a RATCHET, exactly like
 * `scripts/check-silent-catches.mjs`: each file's count of raw reads is recorded
 * in `.unvalidated-bodies-baseline.json`; the guard fails when a count RISES, and
 * equally when it FALLS without the baseline being lowered. The number can only
 * go down, and every step down is a recorded diff.
 *
 *   node scripts/check-unvalidated-bodies.mjs            # CI / `npm test`
 *   node scripts/check-unvalidated-bodies.mjs --update   # after migrating sites
 *
 * `--update` refuses to RAISE a count. A new raw read is a code change to argue
 * about in review, never a baseline edit.
 *
 * A "raw read" is any call `<expr>.req.json(...)` anywhere under `src/` that is
 * not lexically inside a `parseBody(...)` call. The scan covers all of `src/`,
 * not just `src/presentation`: `application/publicApi/*Service.ts` read Hono
 * contexts too (seeded at their counts when the scope widened), and a guard
 * scoped to one layer is a guard a new site walks around by living in another. The scan is an AST walk
 * (borrowing the TypeScript loader from the repo's module-import scanner), so a
 * `c.req.json` inside a string or comment is not a read.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourceFiles, loadTypeScript, toPosix } from '../../scripts/lib/moduleImports.mjs';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(apiRoot, '..');
const targetDir = join(apiRoot, 'src');
const baselinePath = join(apiRoot, 'scripts', '.unvalidated-bodies-baseline.json');

/** The primitive itself performs the one raw read every validated site goes through. */
const EXEMPT = new Set(['src/presentation/routes/requestBody.ts']);

const isCheckedSource = (path) => /\.tsx?$/.test(path)
  && !/\.d\.ts$/.test(path)
  && !/\.(test|spec)\.tsx?$/.test(path);

const ts = loadTypeScript(repoRoot);

/**
 * @param {import('typescript')} ts
 * @param {import('typescript').SourceFile} sourceFile
 * @returns {number[]} 1-indexed lines of each raw read.
 */
function findRawBodyReads(ts, sourceFile) {
  /** @type {number[]} */
  const lines = [];

  const isReqJsonCall = (node) => {
    if (!ts.isCallExpression(node)) return false;
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'json') return false;
    const target = callee.expression;
    return ts.isPropertyAccessExpression(target) && target.name.text === 'req';
  };

  const isParseBodyCall = (node) =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'parseBody';

  const visit = (node, insideParseBody) => {
    const nested = insideParseBody || isParseBodyCall(node);
    if (!nested && isReqJsonCall(node)) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, (child) => visit(child, nested));
  };
  visit(sourceFile, false);
  return lines;
}

/** @type {Record<string, number>} */
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const updating = process.argv.includes('--update');

/** @type {Record<string, number>} */
const counts = {};
/** @type {Record<string, number[]>} */
const sites = {};
let scanned = 0;

for (const filePath of collectSourceFiles(targetDir).filter(isCheckedSource)) {
  const relativePath = toPosix(relative(apiRoot, filePath));
  if (EXEMPT.has(relativePath)) continue;
  const text = readFileSync(filePath, 'utf8');
  scanned += 1;
  if (!text.includes('.json')) continue;
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = findRawBodyReads(ts, sourceFile);
  if (lines.length === 0) continue;
  counts[relativePath] = lines.length;
  sites[relativePath] = lines;
}

const sortedCounts = Object.fromEntries(Object.keys(counts).sort().map((file) => [file, counts[file]]));
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

if (updating) {
  const raised = Object.entries(sortedCounts)
    .filter(([file, count]) => baseline[file] !== undefined && count > baseline[file])
    .map(([file, count]) => `${file}: ${baseline[file]} → ${count}`);
  // A file with no entry yet is being SEEDED — the one time a number may appear.
  // A file that is in the baseline at 0 or absent and now has reads has regressed.
  const appeared = Object.keys(sortedCounts).filter((file) => baseline[file] === undefined && Object.keys(baseline).length > 0);
  if (raised.length > 0 || appeared.length > 0) {
    console.error('Refusing to raise the unvalidated-body baseline — migrate the new sites to parseBody instead:');
    for (const entry of raised) console.error(`  ${entry}`);
    for (const file of appeared) console.error(`  ${file}: (new) ${sortedCounts[file]}`);
    process.exit(1);
  }
  writeFileSync(baselinePath, `${JSON.stringify(sortedCounts, null, 2)}\n`);
  console.log(`Unvalidated-body baseline updated: ${Object.keys(sortedCounts).length} file(s), ${total} raw read(s) from ${scanned} scanned.`);
  process.exit(0);
}

const regressions = [];
const slack = [];
for (const file of new Set([...Object.keys(baseline), ...Object.keys(sortedCounts)])) {
  const allowed = baseline[file] ?? 0;
  const actual = sortedCounts[file] ?? 0;
  if (actual > allowed) regressions.push({ file, allowed, actual });
  else if (actual < allowed) slack.push(`${file}: ${allowed} → ${actual}`);
}

if (regressions.length > 0) {
  console.error(`Unvalidated-body check failed — ${regressions.length} file(s) above baseline:`);
  for (const { file, allowed, actual } of regressions) {
    console.error(`\n  ${file}: ${actual} raw c.req.json read(s) (baseline ${allowed})`);
    console.error('  Read the body with parseBody(c, schema) from presentation/routes/requestBody.ts.');
    for (const line of sites[file] ?? []) console.error(`    ${file}:${line}`);
  }
  process.exit(1);
}

if (slack.length > 0) {
  console.error('Unvalidated-body check failed — the baseline has slack. Run `node scripts/check-unvalidated-bodies.mjs --update` to lock in:');
  for (const entry of slack) console.error(`  ${entry}`);
  process.exit(1);
}

console.log(`Unvalidated-body check passed: ${scanned} presentation files, ${total} raw read(s) across ${Object.keys(sortedCounts).length} file(s) at baseline.`);
