/**
 * canvas-release-audit — the Creation Canvas release gate.
 *
 * ── WHAT WAS WRONG WITH IT ───────────────────────────────────────────────────
 * The twenty-two exit criteria below are the right ones. Where the numbers came
 * from was not: the input was a hand-authored `canvas-release-evidence.json`, and
 * the script's only real validation was that the `REPLACE_` placeholder had been
 * deleted. So the gate certified whatever someone typed, and every "PASS" it
 * printed was a statement about a text file rather than about the release.
 *
 * ── THE TWO INPUT SHAPES ─────────────────────────────────────────────────────
 * It now accepts either:
 *
 *  • MEASURED — a `testPlan` exported from the canvas (`releaseEvidence` in
 *    `frontend/src/lib/canvasQa.ts`). Its `checks` were computed from the runs,
 *    defects and audits actually on the board, so each is reported as (measured).
 *  • DECLARED — the legacy hand-authored file. Still accepted, because the soak,
 *    the dogfood window and the owner sign-offs are genuinely human statements
 *    that no board holds. Each is reported as (declared).
 *
 * A file may carry both; every row prints its own provenance, so a reader can see
 * at a glance how much of a green gate was measured and how much was asserted.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type CanvasCheck = {
  rule?: string;
  ok?: boolean;
  detail?: Record<string, string | number>;
};

type Evidence = {
  release?: string;
  generatedAt?: string;
  /** Canvas export only: the target under test and the derived verdict. */
  target?: string;
  verdict?: string;
  score?: number;
  checks?: CanvasCheck[];
  ownerSignoffs?: Record<string, { owner?: string; approvedAt?: string; evidenceUrl?: string }>;
  metrics?: Record<string, number>;
  artifacts?: Record<string, string[]>;
};

const path = resolve(process.argv[2] || 'canvas-release-evidence.json');
if (!existsSync(path)) {
  process.stderr.write(
    `Missing ${path}.\n` +
    `  • Preferred: open the release's test plan on the canvas and export it as JSON — its checks are computed from the runs and defects on the board.\n` +
    `  • Or: copy docs/design/creation-canvas/evidence/release-evidence.example.json, replace every placeholder with dated evidence, and rerun.\n`,
  );
  process.exit(2);
}

const evidence = JSON.parse(readFileSync(path, 'utf8')) as Evidence;
const metrics = evidence.metrics || {};
const artifacts = evidence.artifacts || {};
const signoffs = evidence.ownerSignoffs || {};
const recorded = (value: unknown) => typeof value === 'string' && value.trim() !== '' && !value.startsWith('REPLACE_');

/** A row's provenance. `measured` came from the board; `declared` came from a human. */
type Source = 'measured' | 'declared';
const checks: Array<[string, boolean, Source]> = [];

checks.push(
  ['release identifier recorded', recorded(evidence.release), 'declared'],
  ['evidence timestamp recorded', recorded(evidence.generatedAt) && !Number.isNaN(Date.parse(evidence.generatedAt!)), 'declared'],
);

/**
 * The canvas half. Each `check` is a gate rule `planGateVerdict` already evaluated
 * against real runs and defects, so it is copied in verbatim rather than re-judged —
 * a second evaluation here would be a second definition of "an open defect".
 */
for (const check of evidence.checks ?? []) {
  if (typeof check?.rule !== 'string') continue;
  const detail = Object.entries(check.detail ?? {}).map(([key, value]) => `${key}=${value}`).join(' ');
  checks.push([`${check.rule}${detail ? ` (${detail})` : ''}`, check.ok === true, 'measured']);
}
if (evidence.checks?.length) {
  checks.push(['plan gate verdict is pass', evidence.verdict === 'pass', 'measured']);
}

/**
 * The declared half — the statements no board holds. Skipped entirely when the file
 * carries none of them, so a canvas export is not failed for lacking a soak record
 * that was never claimed.
 */
const DECLARED_METRIC_KEYS = [
  'dogfoodDays', 'tenantSessions', 'multiplayerSessions', 'commandDataLossRate', 'wrapperSuccessRate',
  'returnToSessionRate', 'sessionApi5xxRate', 'concurrentEditors', 'visibleObjects', 'referencedObjects',
] as const;
// A canvas export always carries `metrics` (passRate, runs, openDefects), so the
// presence of that object is NOT the discriminator — the declared KEYS are. Getting
// this wrong failed a fully-measured, fully-green plan on twenty soak and sign-off
// rows it never claimed to have.
const hasDeclaredEvidence = Object.keys(artifacts).length > 0
  || Object.keys(signoffs).length > 0
  || DECLARED_METRIC_KEYS.some((key) => metrics[key] != null);

if (hasDeclaredEvidence) {
  checks.push(
    ['two-week dogfood completed', (metrics.dogfoodDays || 0) >= 14, 'declared'],
    ['at least 50 tenant Sessions', (metrics.tenantSessions || 0) >= 50, 'declared'],
    ['at least five multiplayer Sessions', (metrics.multiplayerSessions || 0) >= 5, 'declared'],
    ['command/data-loss rate below 0.1%', (metrics.commandDataLossRate ?? Infinity) < .001, 'declared'],
    ['wrapper success at least 99.9%', (metrics.wrapperSuccessRate || 0) >= .999, 'declared'],
    ['return-to-session at least 80%', (metrics.returnToSessionRate || 0) >= .8, 'declared'],
    ['session API 5xx below 0.5%', (metrics.sessionApi5xxRate ?? Infinity) < .005, 'declared'],
    ['25-editor soak recorded', (metrics.concurrentEditors || 0) >= 25, 'declared'],
    ['100 visible Objects exercised', (metrics.visibleObjects || 0) >= 100, 'declared'],
    ['1,000 referenced Objects exercised', (metrics.referencedObjects || 0) >= 1000, 'declared'],
    ['deployed E2E traces attached', (artifacts.deployedE2E || []).length > 0, 'declared'],
    ['security report attached', (artifacts.securityReview || []).length > 0, 'declared'],
    ['accessibility report attached', (artifacts.accessibilityAudit || []).length > 0, 'declared'],
    ['web/VSIX conformance attached', (artifacts.webVsixConformance || []).length > 0, 'declared'],
    ['operations drill records attached', (artifacts.operationsDrills || []).length >= 5, 'declared'],
    ['Product sign-off', recorded(signoffs.product?.owner) && recorded(signoffs.product?.approvedAt) && recorded(signoffs.product?.evidenceUrl), 'declared'],
    ['Platform sign-off', recorded(signoffs.platform?.owner) && recorded(signoffs.platform?.approvedAt) && recorded(signoffs.platform?.evidenceUrl), 'declared'],
    ['Security sign-off', recorded(signoffs.security?.owner) && recorded(signoffs.security?.approvedAt) && recorded(signoffs.security?.evidenceUrl), 'declared'],
    ['Accessibility sign-off', recorded(signoffs.accessibility?.owner) && recorded(signoffs.accessibility?.approvedAt) && recorded(signoffs.accessibility?.evidenceUrl), 'declared'],
    ['SRE/Support sign-off', recorded(signoffs.operations?.owner) && recorded(signoffs.operations?.approvedAt) && recorded(signoffs.operations?.evidenceUrl), 'declared'],
  );
}

for (const [label, passed, source] of checks) process.stdout.write(`${passed ? 'PASS' : 'FAIL'}  ${label} (${source})\n`);

const failed = checks.filter(([, passed]) => !passed).length;
const measured = checks.filter(([, , source]) => source === 'measured').length;
process.stdout.write(`\n${checks.length - failed}/${checks.length} release-evidence checks passed for ${evidence.release || 'unidentified release'}`);
process.stdout.write(` — ${measured} measured from the board, ${checks.length - measured} declared by a human.\n`);
if (!measured) {
  process.stdout.write('NOTE: nothing in this file was measured. Export the release\'s test plan from the canvas to gate on real runs and defects.\n');
}
if (failed) process.exitCode = 1;
