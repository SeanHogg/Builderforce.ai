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
const recorded = (value: unknown) => typeof value === 'string' && value.trim() !== '' && !value.startsWith('REPLACE_');
const checks: Array<[string, boolean]> = [
  ['release identifier recorded', recorded(evidence.release)],
  ['evidence timestamp recorded', recorded(evidence.generatedAt) && !Number.isNaN(Date.parse(evidence.generatedAt!))],
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
  ['Product sign-off', recorded(signoffs.product?.owner) && recorded(signoffs.product?.approvedAt) && recorded(signoffs.product?.evidenceUrl)],
  ['Platform sign-off', recorded(signoffs.platform?.owner) && recorded(signoffs.platform?.approvedAt) && recorded(signoffs.platform?.evidenceUrl)],
  ['Security sign-off', recorded(signoffs.security?.owner) && recorded(signoffs.security?.approvedAt) && recorded(signoffs.security?.evidenceUrl)],
  ['Accessibility sign-off', recorded(signoffs.accessibility?.owner) && recorded(signoffs.accessibility?.approvedAt) && recorded(signoffs.accessibility?.evidenceUrl)],
  ['SRE/Support sign-off', recorded(signoffs.operations?.owner) && recorded(signoffs.operations?.approvedAt) && recorded(signoffs.operations?.evidenceUrl)],
];

for (const [label, passed] of checks) process.stdout.write(`${passed ? 'PASS' : 'FAIL'}  ${label}\n`);
const failed = checks.filter(([, passed]) => !passed).length;
process.stdout.write(`\n${checks.length - failed}/${checks.length} release-evidence checks passed for ${evidence.release || 'unidentified release'}.\n`);
if (failed) process.exitCode = 1;
