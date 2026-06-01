/**
 * Parse Playwright's results.json and POST one run per spec back to
 * /api/qa/runs. The test slug is recovered from the spec filename written by
 * pull-tests.ts; the API resolves it to a qa_tests row (or records an
 * unattributed run for the static baseline smoke spec).
 *
 * Never fails the CI job on a reporting error — results are also uploaded as
 * artifacts; losing the DB write shouldn't mask the actual test outcome.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { login, postRun, baseUrl, projectId, type RunReport } from './bf';

type Manifest = Record<string, { credentialId: string | null; targetId: string | null }>;

function loadManifest(): Manifest {
  try {
    const p = join('.auth', 'tests.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as Manifest;
  } catch {
    /* ignore */
  }
  return {};
}

/** The actual URL tested — written to .auth/config.json by pull-tests (the
 *  project target in project mode), falling back to BF_BASE_URL. */
function resolvedTargetUrl(): string {
  try {
    const p = join('.auth', 'config.json');
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, 'utf8')) as { baseUrl?: string };
      if (cfg.baseUrl) return cfg.baseUrl;
    }
  } catch {
    /* ignore */
  }
  return baseUrl();
}

interface PwStep { title?: string; duration?: number; error?: unknown; category?: string }
interface PwResult { status?: string; duration?: number; error?: { message?: string }; errors?: Array<{ message?: string }>; steps?: PwStep[] }
interface PwTest { results?: PwResult[]; status?: string }
interface PwSpec { title?: string; ok?: boolean; file?: string; tests?: PwTest[] }
interface PwSuite { title?: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] }
interface PwReport { suites?: PwSuite[] }

interface FlatSpec { file: string; spec: PwSpec }

function flatten(suites: PwSuite[] | undefined, inheritedFile: string, out: FlatSpec[]): void {
  for (const s of suites ?? []) {
    const file = s.file ?? inheritedFile;
    for (const spec of s.specs ?? []) out.push({ file: spec.file ?? file, spec });
    flatten(s.suites, file, out);
  }
}

function slugFromFile(file: string): string {
  return basename(file).replace(/\.spec\.ts$/i, '');
}

function statusFor(spec: PwSpec): RunReport['status'] {
  const result = spec.tests?.[0]?.results?.[spec.tests[0].results.length - 1];
  const st = result?.status;
  if (spec.ok && st === 'passed') return 'passed';
  if (st === 'skipped') return 'skipped';
  if (st === 'timedOut' || st === 'failed' || st === 'interrupted') return 'failed';
  return spec.ok ? 'passed' : 'error';
}

function errorFor(spec: PwSpec): string | undefined {
  const result = spec.tests?.[0]?.results?.[0];
  return result?.error?.message ?? result?.errors?.[0]?.message;
}

function durationFor(spec: PwSpec): number {
  return spec.tests?.[0]?.results?.reduce((sum, r) => sum + (r.duration ?? 0), 0) ?? 0;
}

function stepsFor(spec: PwSpec): RunReport['steps'] {
  const raw = spec.tests?.[0]?.results?.[0]?.steps ?? [];
  return raw
    .filter((s) => s.category === 'test.step' || (s.title && !s.title.startsWith('pw:')))
    .slice(0, 100)
    .map((s, i) => ({
      seq: i,
      action: 'step',
      selector: s.title?.slice(0, 400),
      status: s.error ? ('failed' as const) : ('passed' as const),
      durationMs: s.duration,
    }));
}

async function main(): Promise<void> {
  let report: PwReport;
  try {
    report = JSON.parse(readFileSync('results.json', 'utf8')) as PwReport;
  } catch {
    console.warn('[qa-e2e] no results.json to report; skipping.');
    return;
  }

  const specs: FlatSpec[] = [];
  flatten(report.suites, '', specs);
  if (specs.length === 0) {
    console.warn('[qa-e2e] no specs in results.json.');
    return;
  }

  const session = await login();
  const manifest = loadManifest();
  const project = projectId();
  const common = {
    browser: 'chromium',
    targetUrl: resolvedTargetUrl(),
    commitSha: process.env.GITHUB_SHA,
    runKey: process.env.GITHUB_RUN_ID,
  };

  let posted = 0;
  for (const { file, spec } of specs) {
    const slug = slugFromFile(file);
    const attribution = manifest[slug];
    const run: RunReport = {
      testSlug: slug,
      projectId: project,
      credentialId: attribution?.credentialId ?? null,
      targetId: attribution?.targetId ?? null,
      status: statusFor(spec),
      durationMs: durationFor(spec),
      errorMessage: errorFor(spec),
      steps: stepsFor(spec),
      ...common,
    };
    try {
      await postRun(session, run);
      posted++;
    } catch (err) {
      console.warn(`[qa-e2e] failed to post run for ${run.testSlug}:`, err);
    }
  }
  console.log(`[qa-e2e] reported ${posted}/${specs.length} run(s).`);
}

main().catch((err) => {
  console.warn('[qa-e2e] report step error (non-fatal):', err);
});
