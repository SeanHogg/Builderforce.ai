import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const now = JSON.parse(readFileSync('/tmp/api_now.json', 'utf8'));
const byPath = new Map(Object.keys(now).map((k) => [k, now[k]]));
const norm = (s) => s.replace(/\\/g, '/');

const modified = execSync('git status --porcelain -- api/src', { encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean).map((l) => norm(l.slice(3).trim()));

console.log('=== literal-promise-catch sites inside working-tree-modified api/src files ===');
let total = 0;
for (const f of modified) {
  const hits = byPath.get(f) ?? byPath.get('api/src/' + f.replace(/^api\/src\//, ''));
  if (!hits) continue;
  const lit = hits.filter((s) => s.startsWith('literal-promise-catch'));
  if (lit.length) { total += lit.length; console.log(`  ${f} -> ${lit.join(', ')}`); }
}
console.log('TOTAL in modified files: ' + total);

console.log('');
console.log('=== any site in a file owned by commits 68ed4a6c9 / acd26e987 ===');
const owned = [
  'api/migrations/1240_evermind_learning_pipeline.sql',
  'api/src/application/domains/delivery/entities.ts',
  'api/src/application/llm/evermindLearningPipeline.ts',
  'api/src/application/llm/learningPipeline.test.ts',
  'api/src/application/llm/learningPipeline.ts',
  'api/src/infrastructure/database/schema/delivery.ts',
  'api/src/presentation/routes/projectEvermindRoutes.ts',
];
let hits2 = 0;
for (const f of owned) {
  const hits = byPath.get(f);
  console.log(`  ${f}: ${hits ? hits.join(', ') : 'no silent-catch sites'}`);
  if (hits) hits2 += hits.length;
}
console.log('TOTAL owned by the pipeline commits: ' + hits2);