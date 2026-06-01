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
  projectId,
  baseUrl,
  type BfSession,
} from './bf';
import { loginPersona } from './persona-login';

const OUT_DIR = join('tests', 'generated');
const AUTH_DIR = '.auth';

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
  for (const t of tests) {
    const safe = t.slug.replace(/[^a-z0-9-_]/gi, '-');
    writeFileSync(join(OUT_DIR, `${safe}.spec.ts`), t.spec, 'utf8');
    manifest[safe] = { credentialId: null, targetId: null };
  }
  writeFileSync(join(AUTH_DIR, 'tests.json'), JSON.stringify(manifest));
  console.log(`[qa-e2e] self-test: wrote ${tests.length} spec(s).`);
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
  for (const credId of neededCredIds) {
    try {
      const secret = await fetchCredentialSecret(session, credId);
      const state = await loginPersona(bundle.target.baseUrl, secret);
      writeFileSync(credStateFile(credId), JSON.stringify(state));
      loggedIn.add(credId);
    } catch (err) {
      console.warn(`[qa-e2e] persona login failed for credential ${credId}; its tests are skipped:`, err);
    }
  }

  const manifest: Record<string, { credentialId: string | null; targetId: string | null }> = {};
  let written = 0;
  for (const t of bundle.tests) {
    const safe = t.slug.replace(/[^a-z0-9-_]/gi, '-');
    if (t.credentialId && !loggedIn.has(t.credentialId)) continue; // persona login failed → skip
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
