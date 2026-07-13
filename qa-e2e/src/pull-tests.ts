/**
 * Pull active specs from the API and materialize them as files under
 * tests/generated/<slug>.spec.ts so `playwright test` picks them up.
 *
 * Two modes:
 *   - Self-test (no BF_PROJECT_ID): test the Builderforce app itself. Specs run
 *     under the single session minted by global-setup.
 *   - Project (BF_PROJECT_ID set): test a customer project. Resolve the project
 *     target URL, log in each persona via its login form, save one storageState
 *     per credential, and inject `test.use({ storageState })` into each spec so
 *     it runs as its assigned persona.
 *
 * Writes:
 *   .auth/config.json        { baseUrl }            — read by playwright.config
 *   .auth/cred-<id>.json     per-persona storageState (project mode)
 *   .auth/tests.json         { [slug]: { credentialId, targetId } } — for report
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchActiveTests,
  fetchCredentialSecret,
  fetchRunnerBundle,
  login,
  postRun,
  projectId,
  baseUrl,
  type BfSession,
} from './bf';
import { loginPersona } from './persona-login';

const OUT_DIR = join('tests', 'generated');
const AUTH_DIR = '.auth';

/**
 * Defense-in-depth re-validation at the write-to-disk boundary [1067]. The API
 * already validates model output before storing it (QaGeneratorService.
 * validateSpec), but the runner is the last line before `playwright test`
 * executes the file, so we re-check here against the same allowlist/denylist. A
 * spec that fails is skipped (never written), not silently run.
 */
const FORBIDDEN_SPEC = [
  /\brequire\s*\(/, /\bimport\s*\(/, /\beval\s*\(/, /\bnew\s+Function\b/,
  /\bprocess\b/, /\bchild_process\b/, /\bnode:[a-z]/i, /\bfrom\s+['"]fs['"]/,
  /\bglobalThis\b/, /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/,
  /\bpage\.request\b/, /\brequest\.(get|post|put|delete|patch|fetch)\b/,
  /\bpage\.evaluate\w*\s*\(/, /\baddInitScript\b/, /\bexposeFunction\b/,
];
const SPEC_IMPORT_RE = /\bimport\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;

export function specIsSafe(spec: string): boolean {
  if (!spec || spec.length > 16_000 || !spec.includes('@playwright/test')) return false;
  SPEC_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPEC_IMPORT_RE.exec(spec)) !== null) {
    if (m[1] !== '@playwright/test') return false;
  }
  return !FORBIDDEN_SPEC.some((re) => re.test(spec));
}

function credStateFile(credentialId: string): string {
  return join(AUTH_DIR, `cred-${credentialId}.json`);
}

/** Insert `test.use({ storageState })` right after the @playwright/test import. */
function injectStorageState(spec: string, stateFile: string): string {
  const useLine = `\ntest.use({ storageState: ${JSON.stringify(stateFile)} });\n`;
  const importRe = /^.*from\s+['"]@playwright\/test['"];?\s*$/m;
  if (importRe.test(spec)) return spec.replace(importRe, (m) => m + useLine);
  return `import { test } from '@playwright/test';${useLine}${spec}`;
}

function resetDirs(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(AUTH_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.spec.ts')) rmSync(join(OUT_DIR, f));
}

async function pullSelfTest(session: BfSession): Promise<void> {
  const tests = await fetchActiveTests(session);
  resetDirs();
  writeFileSync(join(AUTH_DIR, 'config.json'), JSON.stringify({ baseUrl: baseUrl() }));
  const manifest: Record<string, { credentialId: string | null; targetId: string | null }> = {};
  let skipped = 0;
  for (const t of tests) {
    if (!specIsSafe(t.spec)) {
      console.warn(`[qa-e2e] rejected unsafe spec ${t.slug} (failed static validation); not writing.`);
      skipped++;
      continue;
    }
    const safe = t.slug.replace(/[^a-z0-9-_]/gi, '-');
    writeFileSync(join(OUT_DIR, `${safe}.spec.ts`), t.spec, 'utf8');
    manifest[safe] = { credentialId: null, targetId: null };
  }
  writeFileSync(join(AUTH_DIR, 'tests.json'), JSON.stringify(manifest));
  console.log(`[qa-e2e] self-test: wrote ${tests.length - skipped} spec(s)${skipped ? `, rejected ${skipped} unsafe` : ''}.`);
}

async function pullProject(session: BfSession, project: number): Promise<void> {
  const bundle = await fetchRunnerBundle(session, project);
  if (!bundle.target?.baseUrl) {
    throw new Error(`Project ${project} has no active QA target (root URL). Add one in Observability ▸ Agentic QA.`);
  }
  resetDirs();
  writeFileSync(join(AUTH_DIR, 'config.json'), JSON.stringify({ baseUrl: bundle.target.baseUrl }));

  // Log in each persona referenced by an active test; cache success/failure.
  const neededCredIds = [...new Set(bundle.tests.map((t) => t.credentialId).filter((id): id is string => !!id))];
  const loggedIn = new Set<string>();
  const loginErrors = new Map<string, string>();
  for (const credId of neededCredIds) {
    try {
      const secret = await fetchCredentialSecret(session, credId);
      const state = await loginPersona(bundle.target.baseUrl, secret);
      writeFileSync(credStateFile(credId), JSON.stringify(state));
      loggedIn.add(credId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[qa-e2e] persona login failed for credential ${credId}; its tests are recorded as errors:`, message);
      loginErrors.set(credId, message);
    }
  }

  // Record an `error` run for every test whose persona could not log in, so the
  // failure is visible in the QA dashboard instead of silently skipped [1079].
  for (const t of bundle.tests) {
    if (!t.credentialId || !loginErrors.has(t.credentialId)) continue;
    try {
      await postRun(session, {
        testSlug: t.slug,
        projectId: project,
        credentialId: t.credentialId,
        targetId: bundle.target.id,
        status: 'error',
        targetUrl: bundle.target.baseUrl,
        commitSha: process.env.GITHUB_SHA,
        runKey: process.env.GITHUB_RUN_ID,
        errorMessage: `Persona login failed: ${loginErrors.get(t.credentialId)}`,
      });
    } catch (err) {
      console.warn(`[qa-e2e] failed to record login-error run for ${t.slug}:`, err);
    }
  }

  const manifest: Record<string, { credentialId: string | null; targetId: string | null }> = {};
  let written = 0;
  for (const t of bundle.tests) {
    const safe = t.slug.replace(/[^a-z0-9-_]/gi, '-');
    if (t.credentialId && !loggedIn.has(t.credentialId)) continue; // persona login failed → skip
    if (!specIsSafe(t.spec)) {
      console.warn(`[qa-e2e] rejected unsafe spec ${t.slug} (failed static validation); not writing.`);
      continue;
    }
    const spec = t.credentialId ? injectStorageState(t.spec, credStateFile(t.credentialId)) : t.spec;
    writeFileSync(join(OUT_DIR, `${safe}.spec.ts`), spec, 'utf8');
    manifest[safe] = { credentialId: t.credentialId, targetId: bundle.target.id };
    written++;
  }
  writeFileSync(join(AUTH_DIR, 'tests.json'), JSON.stringify(manifest));
  console.log(`[qa-e2e] project ${project}: target ${bundle.target.baseUrl}, ${loggedIn.size}/${neededCredIds.length} persona(s) logged in, ${written} spec(s) written.`);
}

async function main(): Promise<void> {
  const session = await login();
  const project = projectId();
  if (project != null) await pullProject(session, project);
  else await pullSelfTest(session);
}

main().catch((err) => {
  console.error('[qa-e2e] pull-tests failed:', err);
  process.exit(1);
});
