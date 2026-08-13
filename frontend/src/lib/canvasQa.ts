/**
 * The QA objects' domain logic — plans, cases, runs, defects and coverage.
 *
 * ── WHAT THIS EXISTS TO ANSWER ───────────────────────────────────────────────────
 * "I'm trying to create automation tests, can you create them for my website?"
 *
 * That sentence has to end in files someone can run, on a board someone can keep, and
 * it has to work for a visitor with no account — so every function here is PURE and
 * runs in the browser. Route discovery and the Playwright lowering come from the
 * shared contract (`@builderforce/creation-canvas-contract`), which is the same code
 * the API's generator uses, so a spec shown on a board and a spec stored in the
 * tenant's QA library are byte-identical for the same steps.
 *
 * ── WHY THE GATE LIVES ON THE PLAN ───────────────────────────────────────────────
 * The Creation Canvas release gate was a hand-authored `canvas-release-evidence.json`
 * audited by a CLI whose only real check was that the `REPLACE_` placeholder had been
 * deleted — so it certified whatever someone typed. `planGateVerdict` computes the
 * same shape of verdict from the runs and defects ACTUALLY on the board, and
 * `releaseEvidence` exports it in the form the CLI reads. Evidence is derived, not
 * declared.
 *
 * Nothing here formats an English sentence: every check returns a `rule` plus a
 * `detail` map that the node body interpolates into a localized string, the same
 * convention `canvasDataQuality` established.
 */

import {
  findingFingerprint,
  normalizeQaSteps,
  playwrightSpec,
  routesFromHtml,
  severityRank,
  smokeStepsForRoute,
  toSlug,
  shortHash,
  QA_SEVERITIES,
  type QaFindingSeverity,
  type QaStep,
} from '@builderforce/creation-canvas-contract';

export type { QaStep, QaFindingSeverity };
export { QA_SEVERITIES };

// ───────────────────────────────────────────────────────────────────────────
// Shapes stored on the objects
// ───────────────────────────────────────────────────────────────────────────

/** One executable scenario, as it sits on a `testCase` object. */
export interface CanvasTestCase {
  id: string;
  title: string;
  /** What this case proves, in the author's words. */
  intent?: string;
  route?: string;
  steps: QaStep[];
  /** The lowered Playwright source. Derived from `steps` — never authored apart. */
  spec: string;
  priority: 'critical' | 'high' | 'normal';
}

/** Per-case outcome inside a `testRun`. */
export interface CanvasTestResult {
  caseId: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  durationMs?: number;
  errorMessage?: string;
  /** Which step index failed, when the runner reported one. */
  failedStep?: number;
}

/** The exit criteria a `testPlan` gates a release on. Every field is optional: a
 *  plan with no criteria is a plan, not a gate, and says so. */
export interface CanvasExitCriteria {
  /** Percentage of cases that must pass, 0–100. */
  minPassRate?: number;
  /** Open defects tolerated at any severity. */
  maxOpenDefects?: number;
  /** Open defects tolerated at critical/high. */
  maxSevereDefects?: number;
  /** An accessibility audit must be attached to the plan and passing. */
  requireAccessibility?: boolean;
  /** Owners who must have signed off, by name/role. */
  signOffs?: string[];
}

export interface CanvasSignOff {
  owner: string;
  approvedAt: string;
  note?: string;
}

/** One gate check, localized by the caller from `rule` + `detail`. */
export interface CanvasGateCheck {
  rule: 'passRate' | 'openDefects' | 'severeDefects' | 'accessibility' | 'signOff' | 'hasRun';
  ok: boolean;
  detail?: Record<string, string | number>;
}

export interface CanvasGateVerdict {
  status: 'pass' | 'fail' | 'pending';
  checks: CanvasGateCheck[];
  /** Share of declared criteria satisfied, 0–100 — the plan card's headline. */
  score: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Authoring a plan
// ───────────────────────────────────────────────────────────────────────────

/** Named journeys worth a case on ANY site, used when the author gave routes but no
 *  scenarios. Deliberately short: a generated plan that guesses at ten user stories
 *  is a plan nobody trusts, and each of these is derivable from the target itself. */
const BASELINE_JOURNEYS: ReadonlyArray<{ key: string; match: RegExp; selector: string }> = [
  { key: 'primaryNav', match: /^\/$/, selector: 'role=navigation' },
  { key: 'primaryCta', match: /^\/$/, selector: 'role=link' },
  { key: 'contactForm', match: /contact|enquir|quote|demo/i, selector: 'role=button[name=Submit]' },
  { key: 'search', match: /search/i, selector: 'role=searchbox' },
];

export interface BuildPlanInput {
  /** What the plan is called — usually the site or the release. */
  name: string;
  /** Absolute URL of the system under test. */
  targetUrl: string;
  /** Route paths to cover. When empty, the plan covers `/` only. */
  routes?: readonly string[];
  /** Extra scenarios the author or the model described, each with its own steps. */
  scenarios?: ReadonlyArray<{ title: string; intent?: string; route?: string; steps?: unknown; priority?: string }>;
  exitCriteria?: CanvasExitCriteria;
}

export interface BuiltPlan {
  plan: {
    title: string;
    targetUrl: string;
    routes: string[];
    exitCriteria: CanvasExitCriteria;
    slug: string;
    status: string;
    summary: string;
  };
  cases: CanvasTestCase[];
}

/** Normalize a URL to an origin we can test against, or null when it is not one. */
export function testTargetUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname.includes('.')) return null;
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
  } catch {
    return null;
  }
}

/** Route paths, deduplicated, always including the site root. */
export function normalizeRoutes(routes: readonly string[] | undefined): string[] {
  const seen = new Set<string>(['/']);
  for (const raw of routes ?? []) {
    if (typeof raw !== 'string') continue;
    let path = raw.trim();
    if (!path) continue;
    if (/^https?:\/\//i.test(path)) {
      try { path = new URL(path).pathname; } catch { continue; }
    }
    if (!path.startsWith('/')) path = `/${path}`;
    path = path.replace(/\/+$/, '') || '/';
    if (path.length > 120) continue;
    seen.add(path);
  }
  return [...seen].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

const CASE_PRIORITIES = new Set(['critical', 'high', 'normal']);

function casePriority(value: unknown, route: string): CanvasTestCase['priority'] {
  if (typeof value === 'string' && CASE_PRIORITIES.has(value)) return value as CanvasTestCase['priority'];
  return route === '/' ? 'critical' : 'normal';
}

/**
 * Build a plan and its cases from a target and whatever the author knows.
 *
 * The result is deterministic for the same input — the same board rebuilt tomorrow
 * produces the same case ids and the same specs, which is what makes a diff of two
 * plans meaningful and what lets a re-run update a case rather than duplicate it.
 */
export function buildTestPlan(input: BuildPlanInput): BuiltPlan {
  const targetUrl = testTargetUrl(input.targetUrl) ?? input.targetUrl.trim();
  const routes = normalizeRoutes(input.routes);
  const slug = toSlug(input.name || targetUrl, 'test-plan');
  const cases: CanvasTestCase[] = [];

  for (const route of routes) {
    const title = route === '/' ? `Home page loads` : `${route} loads`;
    const steps = smokeStepsForRoute(route);
    // A route that a baseline journey recognises gets one extra assertion, so the
    // generated suite proves something happened rather than only that a page
    // answered 200.
    for (const journey of BASELINE_JOURNEYS) {
      if (journey.match.test(route)) {
        steps.push({ action: 'expect', selector: journey.selector, assertion: journey.key });
        break;
      }
    }
    cases.push(makeCase({ slug, title, route, steps, priority: casePriority(undefined, route) }));
  }

  for (const scenario of input.scenarios ?? []) {
    const title = String(scenario.title ?? '').trim();
    if (!title) continue;
    const authored = normalizeQaSteps(scenario.steps);
    const route = typeof scenario.route === 'string' && scenario.route.trim() ? normalizeRoutes([scenario.route])[1] ?? '/' : undefined;
    const steps = authored.length ? authored : smokeStepsForRoute(route ?? '/');
    cases.push(makeCase({
      slug, title, steps,
      ...(route ? { route } : {}),
      ...(scenario.intent ? { intent: scenario.intent } : {}),
      priority: casePriority(scenario.priority, route ?? '/'),
    }));
  }

  const exitCriteria = normalizeExitCriteria(input.exitCriteria);
  return {
    plan: {
      title: input.name.trim() || targetUrl,
      targetUrl,
      routes,
      exitCriteria,
      slug,
      status: `${cases.length} case${cases.length === 1 ? '' : 's'}`,
      summary: `${cases.length} generated Playwright case(s) over ${routes.length} route(s) of ${targetUrl}.`,
    },
    cases,
  };
}

function makeCase(input: { slug: string; title: string; route?: string; intent?: string; steps: QaStep[]; priority: CanvasTestCase['priority'] }): CanvasTestCase {
  const steps = normalizeQaSteps(input.steps);
  return {
    id: `${input.slug}-${shortHash(`${input.title}|${JSON.stringify(steps)}`)}`,
    title: input.title,
    ...(input.route ? { route: input.route } : {}),
    ...(input.intent ? { intent: input.intent } : {}),
    steps,
    spec: playwrightSpec({ name: input.title, slug: toSlug(input.title, 'case'), steps, startRoute: input.route ?? '/' }),
    priority: input.priority,
  };
}

/** Re-lower a case after its steps were edited, so the spec can never go stale. */
export function relowerCase(testCase: CanvasTestCase): CanvasTestCase {
  const steps = normalizeQaSteps(testCase.steps);
  return {
    ...testCase,
    steps,
    spec: playwrightSpec({ name: testCase.title, slug: toSlug(testCase.title, 'case'), steps, startRoute: testCase.route ?? '/' }),
  };
}

export function normalizeExitCriteria(value: unknown): CanvasExitCriteria {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const num = (key: string, max: number): number | undefined => {
    const candidate = Number(raw[key]);
    return Number.isFinite(candidate) && candidate >= 0 ? Math.min(candidate, max) : undefined;
  };
  const criteria: CanvasExitCriteria = {};
  const passRate = num('minPassRate', 100);
  if (passRate != null) criteria.minPassRate = passRate;
  const openDefects = num('maxOpenDefects', 10_000);
  if (openDefects != null) criteria.maxOpenDefects = openDefects;
  const severe = num('maxSevereDefects', 10_000);
  if (severe != null) criteria.maxSevereDefects = severe;
  if (raw.requireAccessibility === true) criteria.requireAccessibility = true;
  if (Array.isArray(raw.signOffs)) {
    const owners = raw.signOffs.filter((owner): owner is string => typeof owner === 'string' && owner.trim().length > 0).slice(0, 12);
    if (owners.length) criteria.signOffs = owners;
  }
  return criteria;
}

/** Read cases off an object's stored data, tolerating a hand-edited payload. */
export function readTestCases(value: unknown): CanvasTestCase[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '';
    if (!title) return [];
    const steps = normalizeQaSteps(item.steps);
    const route = typeof item.route === 'string' ? item.route : undefined;
    return [{
      id: typeof item.id === 'string' && item.id ? item.id : `case-${shortHash(title)}`,
      title,
      ...(route ? { route } : {}),
      ...(typeof item.intent === 'string' && item.intent ? { intent: item.intent } : {}),
      steps,
      spec: typeof item.spec === 'string' && item.spec.includes('@playwright/test')
        ? item.spec
        : playwrightSpec({ name: title, steps, startRoute: route ?? '/' }),
      priority: casePriority(item.priority, route ?? '/'),
    }];
  });
}

export function readTestResults(value: unknown): CanvasTestResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const status = item.status;
    if (status !== 'passed' && status !== 'failed' && status !== 'skipped' && status !== 'error') return [];
    return [{
      caseId: typeof item.caseId === 'string' ? item.caseId : '',
      title: typeof item.title === 'string' ? item.title : '',
      status,
      ...(Number.isFinite(Number(item.durationMs)) ? { durationMs: Number(item.durationMs) } : {}),
      ...(typeof item.errorMessage === 'string' && item.errorMessage ? { errorMessage: item.errorMessage.slice(0, 600) } : {}),
      ...(Number.isFinite(Number(item.failedStep)) ? { failedStep: Number(item.failedStep) } : {}),
    }];
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Runs
// ───────────────────────────────────────────────────────────────────────────

export interface CanvasRunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  /** 0–100, over the cases that actually ran (skipped excluded). */
  passRate: number;
  status: 'passed' | 'failed' | 'empty';
}

export function summarizeRun(results: readonly CanvasTestResult[]): CanvasRunSummary {
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const errored = results.filter((r) => r.status === 'error').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const ran = results.length - skipped;
  return {
    total: results.length,
    passed, failed, skipped, errored,
    passRate: ran > 0 ? Math.round((passed / ran) * 100) : 0,
    status: results.length === 0 ? 'empty' : failed + errored > 0 ? 'failed' : 'passed',
  };
}

/**
 * A defect authored from a failed result.
 *
 * Fingerprinted with the SAME function the server uses for an exploration finding, so
 * the same break reported from a canvas run and from the Agentic Tester is one defect
 * rather than two — which is the whole reason the fingerprint is in the shared
 * contract rather than in either consumer.
 */
export function defectFromResult(
  result: CanvasTestResult,
  context: { targetUrl?: string; route?: string; caseTitle?: string; steps?: readonly QaStep[] },
): Record<string, unknown> {
  const message = result.errorMessage || `${result.title || context.caseTitle || 'case'} did not pass`;
  const severity: QaFindingSeverity = result.status === 'error' ? 'critical' : 'high';
  return {
    title: `${result.title || context.caseTitle || 'Test'} failed`,
    severity,
    defectType: 'assertion',
    status: 'open',
    route: context.route ?? '',
    ...(context.targetUrl ? { targetUrl: context.targetUrl } : {}),
    expected: context.caseTitle ? `${context.caseTitle} passes` : 'the case passes',
    actual: message,
    reproSteps: normalizeQaSteps(context.steps ?? []),
    fingerprint: findingFingerprint({ type: 'assertion', route: context.route ?? null, selector: null, message }),
    caseId: result.caseId,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The gate
// ───────────────────────────────────────────────────────────────────────────

export interface GateEvidence {
  runs: ReadonlyArray<{ passRate: number; status: string; finishedAt?: string }>;
  defects: ReadonlyArray<{ severity: QaFindingSeverity; status: string }>;
  /** Attached accessibility/performance audits and whether each passed. */
  audits: ReadonlyArray<{ passed: boolean }>;
  signOffs: readonly CanvasSignOff[];
}

/**
 * Evaluate a plan's exit criteria against the evidence on the board.
 *
 * `pending` rather than `fail` when a criterion has no evidence yet: a plan whose
 * suite has never run has not FAILED its gate, and colouring it red teaches everyone
 * to ignore the colour.
 */
export function planGateVerdict(criteria: CanvasExitCriteria, evidence: GateEvidence): CanvasGateVerdict {
  const checks: CanvasGateCheck[] = [];
  const latest = evidence.runs[0];
  const openDefects = evidence.defects.filter((defect) => defect.status !== 'closed' && defect.status !== 'verified');
  const severe = openDefects.filter((defect) => severityRank(defect.severity) >= severityRank('high'));

  if (criteria.minPassRate != null) {
    checks.push(latest
      ? { rule: 'passRate', ok: latest.passRate >= criteria.minPassRate, detail: { actual: latest.passRate, required: criteria.minPassRate } }
      : { rule: 'hasRun', ok: false, detail: { required: criteria.minPassRate } });
  }
  if (criteria.maxOpenDefects != null) {
    checks.push({ rule: 'openDefects', ok: openDefects.length <= criteria.maxOpenDefects, detail: { actual: openDefects.length, allowed: criteria.maxOpenDefects } });
  }
  if (criteria.maxSevereDefects != null) {
    checks.push({ rule: 'severeDefects', ok: severe.length <= criteria.maxSevereDefects, detail: { actual: severe.length, allowed: criteria.maxSevereDefects } });
  }
  if (criteria.requireAccessibility) {
    checks.push({ rule: 'accessibility', ok: evidence.audits.length > 0 && evidence.audits.every((audit) => audit.passed), detail: { audits: evidence.audits.length } });
  }
  for (const owner of criteria.signOffs ?? []) {
    checks.push({
      rule: 'signOff',
      ok: evidence.signOffs.some((signOff) => signOff.owner.toLowerCase() === owner.toLowerCase()),
      detail: { owner },
    });
  }

  const satisfied = checks.filter((check) => check.ok).length;
  const pendingOnly = checks.length > 0 && checks.every((check) => check.ok || check.rule === 'hasRun');
  return {
    checks,
    score: checks.length ? Math.round((satisfied / checks.length) * 100) : 0,
    status: checks.length === 0 ? 'pending' : satisfied === checks.length ? 'pass' : pendingOnly ? 'pending' : 'fail',
  };
}

/**
 * The plan, its evidence and its verdict in the shape `canvas-release-audit` reads.
 *
 * This is the half that makes the CLI gate honest: the numbers come from runs and
 * defects on the board rather than from a hand-typed file whose only validation was
 * that the placeholder had been removed.
 */
export function releaseEvidence(
  plan: { title: string; targetUrl?: string; exitCriteria?: CanvasExitCriteria },
  evidence: GateEvidence,
  generatedAt: string,
): Record<string, unknown> {
  const verdict = planGateVerdict(normalizeExitCriteria(plan.exitCriteria), evidence);
  const latest = evidence.runs[0];
  return {
    release: plan.title,
    generatedAt,
    target: plan.targetUrl ?? '',
    verdict: verdict.status,
    score: verdict.score,
    metrics: {
      passRate: latest?.passRate ?? 0,
      runs: evidence.runs.length,
      openDefects: evidence.defects.filter((defect) => defect.status !== 'closed' && defect.status !== 'verified').length,
      accessibilityAudits: evidence.audits.length,
    },
    checks: verdict.checks,
    ownerSignoffs: Object.fromEntries(evidence.signOffs.map((signOff) => [signOff.owner, { owner: signOff.owner, approvedAt: signOff.approvedAt }])),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Coverage
// ───────────────────────────────────────────────────────────────────────────

/**
 * Kinds that SHOULD be verified before anyone ships them.
 *
 * A board holds a lot that has no meaningful test — a note, a frame, a sticky. The
 * denominator of a coverage number is what makes it trustworthy, so it is declared
 * rather than "every object that is not a test".
 */
export const COVERABLE_KINDS: ReadonlySet<string> = new Set([
  'prd', 'task', 'featureSummary', 'release', 'objective',
  'website', 'build', 'prototype', 'workflow', 'code', 'service', 'browser', 'url',
  'game', 'mockup', 'agent', 'guidedTour', 'emailCampaign', 'socialCampaign',
]);

export interface CoverageNode { id: string; kind: string; title: string }
export interface CoverageEdge { source: string; target: string; connectionKind?: string }

export interface CoverageReport {
  covered: Array<{ id: string; kind: string; title: string; verifiedBy: string[] }>;
  uncovered: Array<{ id: string; kind: string; title: string }>;
  /** Cases that verify nothing — written, and proving nothing anyone declared. */
  orphanCases: Array<{ id: string; title: string }>;
  coveragePct: number;
  total: number;
}

/**
 * What on this board is proven, and by what.
 *
 * Computed over `verifies` edges ONLY. Using `reference` would report a board as
 * fully covered because its objects happen to be connected, which is worse than no
 * number at all.
 */
export function coverageReport(nodes: readonly CoverageNode[], edges: readonly CoverageEdge[]): CoverageReport {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const verifying = edges.filter((edge) => edge.connectionKind === 'verifies');
  const verifiers = new Map<string, string[]>();
  const proves = new Map<string, number>();
  for (const edge of verifying) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    verifiers.set(edge.target, [...(verifiers.get(edge.target) ?? []), source.title]);
    proves.set(edge.source, (proves.get(edge.source) ?? 0) + 1);
  }

  const coverable = nodes.filter((node) => COVERABLE_KINDS.has(node.kind));
  const covered = coverable
    .filter((node) => verifiers.has(node.id))
    .map((node) => ({ id: node.id, kind: node.kind, title: node.title, verifiedBy: verifiers.get(node.id) ?? [] }));
  const uncovered = coverable
    .filter((node) => !verifiers.has(node.id))
    .map((node) => ({ id: node.id, kind: node.kind, title: node.title }));
  const orphanCases = nodes
    .filter((node) => (node.kind === 'testCase' || node.kind === 'testPlan') && !proves.has(node.id))
    .map((node) => ({ id: node.id, title: node.title }));

  return {
    covered, uncovered, orphanCases,
    total: coverable.length,
    coveragePct: coverable.length ? Math.round((covered.length / coverable.length) * 100) : 0,
  };
}

/** Route discovery from a fetched page, re-exported so the canvas has one import. */
export { routesFromHtml };
