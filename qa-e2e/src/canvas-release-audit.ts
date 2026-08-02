import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Evidence = {
  release?: string;
  generatedAt?: string;
  ownerSignoffs?: Record<string, { owner?: string; approvedAt?: string; evidenceUrl?: string }>;
  metrics?: Record<string, number>;
  artifacts?: Record<string, string[]>;
};

const path = resolve(process.argv[2] || 'canvas-release-evidence.json');
if (!existsSync(path)) {
  process.stderr.write(`Missing ${path}. Copy docs/design/creation-canvas/evidence/release-evidence.example.json, replace every placeholder with dated evidence, and rerun.\n`);
  process.exit(2);
}

const evidence = JSON.parse(readFileSync(path, 'utf8')) as Evidence;
const metrics = evidence.metrics || {};
const artifacts = evidence.artifacts || {};
const signoffs = evidence.ownerSignoffs || {};
const checks: Array<[string, boolean]> = [
  ['release identifier recorded', !!evidence.release],
  ['evidence timestamp recorded', !!evidence.generatedAt],
  ['two-week dogfood completed', (metrics.dogfoodDays || 0) >= 14],
  ['at least 50 tenant Sessions', (metrics.tenantSessions || 0) >= 50],
  ['at least five multiplayer Sessions', (metrics.multiplayerSessions || 0) >= 5],
  ['command/data-loss rate below 0.1%', (metrics.commandDataLossRate || Infinity) < .001],
  ['wrapper success at least 99.9%', (metrics.wrapperSuccessRate || 0) >= .999],
  ['return-to-session at least 80%', (metrics.returnToSessionRate || 0) >= .8],
  ['session API 5xx below 0.5%', (metrics.sessionApi5xxRate || Infinity) < .005],
  ['25-editor soak recorded', (metrics.concurrentEditors || 0) >= 25],
  ['100 visible Objects exercised', (metrics.visibleObjects || 0) >= 100],
  ['1,000 referenced Objects exercised', (metrics.referencedObjects || 0) >= 1000],
  ['deployed E2E traces attached', (artifacts.deployedE2E || []).length > 0],
  ['security report attached', (artifacts.securityReview || []).length > 0],
  ['accessibility report attached', (artifacts.accessibilityAudit || []).length > 0],
  ['web/VSIX conformance attached', (artifacts.webVsixConformance || []).length > 0],
  ['operations drill records attached', (artifacts.operationsDrills || []).length >= 5],
  ['Product sign-off', !!signoffs.product?.owner && !!signoffs.product?.approvedAt && !!signoffs.product?.evidenceUrl],
  ['Platform sign-off', !!signoffs.platform?.owner && !!signoffs.platform?.approvedAt && !!signoffs.platform?.evidenceUrl],
  ['Security sign-off', !!signoffs.security?.owner && !!signoffs.security?.approvedAt && !!signoffs.security?.evidenceUrl],
  ['Accessibility sign-off', !!signoffs.accessibility?.owner && !!signoffs.accessibility?.approvedAt && !!signoffs.accessibility?.evidenceUrl],
  ['SRE/Support sign-off', !!signoffs.operations?.owner && !!signoffs.operations?.approvedAt && !!signoffs.operations?.evidenceUrl],
];

for (const [label, passed] of checks) process.stdout.write(`${passed ? 'PASS' : 'FAIL'}  ${label}\n`);
const failed = checks.filter(([, passed]) => !passed).length;
process.stdout.write(`\n${checks.length - failed}/${checks.length} release-evidence checks passed for ${evidence.release || 'unidentified release'}.\n`);
if (failed) process.exitCode = 1;

