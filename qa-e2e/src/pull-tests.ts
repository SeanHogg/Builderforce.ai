/**
 * Pull active AI-generated specs from the API and materialize them as files
 * under tests/generated/<slug>.spec.ts so `playwright test` picks them up.
 *
 * The filename encodes the test slug; src/report.ts reads it back to attribute
 * each result to its qa_tests row when posting runs.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchActiveTests, login } from './bf';

const OUT_DIR = join('tests', 'generated');

async function main(): Promise<void> {
  const session = await login();
  const tests = await fetchActiveTests(session);

  // Clean previously generated specs so removed/archived tests don't linger.
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith('.spec.ts')) rmSync(join(OUT_DIR, f));
  }

  for (const t of tests) {
    const safe = t.slug.replace(/[^a-z0-9-_]/gi, '-');
    writeFileSync(join(OUT_DIR, `${safe}.spec.ts`), t.spec, 'utf8');
  }
  // eslint-disable-next-line no-console
  console.log(`[qa-e2e] wrote ${tests.length} generated spec(s) to ${OUT_DIR}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[qa-e2e] pull-tests failed:', err);
  process.exit(1);
});
