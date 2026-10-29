import { resolve, join, relative } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { collectSourceFiles, loadTypeScript, toPosix } from './scripts/lib/moduleImports.mjs';
import { findSilentCatches, RULES } from './scripts/lib/silentCatchRules.mjs';
const repoRoot = resolve('.');
const ts = loadTypeScript(repoRoot);
const isCheckedSource = (p)=>/\.tsx?$/.test(p)&&!/\.d\.ts$/.test(p)&&!/\.(test|spec)\.tsx?$/.test(p);
const target = process.argv[2];
const out = {};
for (const filePath of collectSourceFiles(join(repoRoot,...target.split('/'))).filter(isCheckedSource)) {
  const rel = toPosix(relative(repoRoot, filePath));
  const sf = ts.createSourceFile(filePath, readFileSync(filePath,'utf8'), ts.ScriptTarget.Latest, true, filePath.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const v = findSilentCatches(ts, sf, rel, ()=>false);
  if (v.length) out[rel] = v.map(x=>x.rule+'@'+x.line);
}
writeFileSync(process.argv[3], JSON.stringify(out,null,1));
console.log('files:',Object.keys(out).length,'sites:',Object.values(out).flat().length);
