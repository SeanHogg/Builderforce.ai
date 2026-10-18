import { resolve, join, relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { collectSourceFiles, loadTypeScript, toPosix } from './scripts/lib/moduleImports.mjs';
import { findSilentCatches } from './scripts/lib/silentCatchRules.mjs';

const repoRoot = resolve('.');
const ts = loadTypeScript(repoRoot);
const RULE = 'literal-promise-catch';
const isCheckedSource = (p) => /\.tsx?$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p);

function countFromSource(filePath, source) {
  const rel = toPosix(relative(repoRoot, filePath));
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return findSilentCatches(ts, sf, rel, () => false).filter((v) => v.rule === RULE).length;
}

// Every api/src file at HEAD, vs on disk.
const headFiles = execSync('git ls-tree -r --name-only HEAD -- api/src', { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split(/\r?\n/).filter(Boolean).filter(isCheckedSource);

const deltas = [];
let headTotal = 0, nowTotal = 0;
for (const rel of headFiles) {
  let headSrc;
  try { headSrc = execSync(`git show HEAD:${rel}`, { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { continue; }
  const abs = join(repoRoot, rel);
  const headCount = countFromSource(abs, headSrc);
  let nowCount;
  try { nowCount = countFromSource(abs, readFileSync(abs, 'utf8')); } catch { continue; }
  headTotal += headCount; nowTotal += nowCount;
  if (nowCount !== headCount) deltas.push([rel, headCount, nowCount]);
}
console.log(`api/src ${RULE}: HEAD=${headTotal}  working-tree=${nowTotal}  delta=${nowTotal - headTotal}`);
console.log('');
console.log('files whose count changed vs HEAD:');
for (const [rel, h, n] of deltas.sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]))) {
  console.log(`  ${rel}  ${h} -> ${n}  (${n - h >= 0 ? '+' : ''}${n - h})`);
}