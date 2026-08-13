import { describe, it, expect } from 'vitest';
import {
  buildTestPlan, coverageReport, defectFromResult, normalizeRoutes, planGateVerdict,
  readTestCases, relowerCase, releaseEvidence, summarizeRun, testTargetUrl,
} from './canvasQa';
import { routesFromHtml, normalizeQaSteps, playwrightSpec } from '@builderforce/creation-canvas-contract';

describe('testTargetUrl', () => {
  it('accepts a bare host and normalizes to an origin', () => {
    expect(testTargetUrl('example.com')).toBe('https://example.com');
    expect(testTargetUrl('https://shop.example.com/store/')).toBe('https://shop.example.com/store');
  });

  it('rejects something that is not a host', () => {
    expect(testTargetUrl('my website')).toBeNull();
    expect(testTargetUrl('')).toBeNull();
  });
});

describe('normalizeRoutes', () => {
  it('always includes root, dedupes, and shallowest first', () => {
    expect(normalizeRoutes(['/pricing/', 'about', '/pricing', 'https://example.com/blog/post'])).toEqual([
      '/', '/about', '/pricing', '/blog/post',
    ]);
  });
});

describe('buildTestPlan — the "create tests for my website" path', () => {
  const built = buildTestPlan({ name: 'Acme site', targetUrl: 'acme.example', routes: ['/pricing', '/contact'] });

  it('covers every route with a runnable spec', () => {
    expect(built.plan.targetUrl).toBe('https://acme.example');
    expect(built.plan.routes).toEqual(['/', '/contact', '/pricing']);
    expect(built.cases).toHaveLength(3);
    for (const testCase of built.cases) {
      expect(testCase.spec).toContain("import { test, expect } from '@playwright/test';");
      expect(testCase.spec).toContain('await page.goto(');
      // Every navigation asserts health — a smoke test that cannot fail is not one.
      expect(testCase.spec).toContain('not.toHaveURL(/\\/login/)');
    }
  });

  it('is deterministic — the same input rebuilds the same case ids', () => {
    const again = buildTestPlan({ name: 'Acme site', targetUrl: 'acme.example', routes: ['/pricing', '/contact'] });
    expect(again.cases.map((c) => c.id)).toEqual(built.cases.map((c) => c.id));
  });

  it('lowers an authored scenario rather than replacing it with a smoke case', () => {
    const custom = buildTestPlan({
      name: 'Acme', targetUrl: 'acme.example',
      scenarios: [{
        title: 'Visitor requests a quote',
        priority: 'critical',
        steps: [
          { action: 'goto', route: '/contact' },
          { action: 'fill', selector: 'label=Email', value: 'qa@example.com' },
          { action: 'click', selector: 'role=button[name=Send]' },
          { action: 'expect', selector: 'text=Thanks', assertion: 'confirmation shows' },
        ],
      }],
    });
    const scenario = custom.cases.find((c) => c.title === 'Visitor requests a quote');
    expect(scenario?.priority).toBe('critical');
    expect(scenario?.spec).toContain("page.getByLabel('Email')");
    expect(scenario?.spec).toContain("page.getByRole('button', { name: 'Send' })");
    expect(scenario?.spec).toContain("page.getByText('Thanks')");
  });

  it('drops a step whose action cannot work without a field it does not have', () => {
    expect(normalizeQaSteps([{ action: 'goto' }, { action: 'click' }, { action: 'goto', route: '/ok' }])).toEqual([
      { action: 'goto', route: '/ok' },
    ]);
  });
});

describe('relowerCase', () => {
  it('regenerates the spec so edited steps can never drift from it', () => {
    const [first] = buildTestPlan({ name: 'x', targetUrl: 'x.example' }).cases;
    const edited = relowerCase({ ...first!, steps: [{ action: 'goto', route: '/changed' }] });
    expect(edited.spec).toContain("page.goto('/changed')");
    expect(edited.spec).not.toContain("page.goto('/')");
  });
});

describe('readTestCases', () => {
  it('rebuilds a missing spec instead of returning a case nothing can run', () => {
    const [restored] = readTestCases([{ title: 'Home loads', route: '/', steps: [{ action: 'goto', route: '/' }] }]);
    expect(restored?.spec).toContain('@playwright/test');
  });

  it('ignores a payload with no title', () => {
    expect(readTestCases([{ steps: [] }, null, 'nope'])).toEqual([]);
  });
});

describe('summarizeRun', () => {
  it('excludes skipped cases from the pass rate', () => {
    const summary = summarizeRun([
      { caseId: 'a', title: 'a', status: 'passed' },
      { caseId: 'b', title: 'b', status: 'failed' },
      { caseId: 'c', title: 'c', status: 'skipped' },
    ]);
    expect(summary).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1, passRate: 50, status: 'failed' });
  });

  it('reports empty rather than a 0% pass rate for a run with nothing in it', () => {
    expect(summarizeRun([]).status).toBe('empty');
  });
});

describe('defectFromResult', () => {
  it('carries the repro and fingerprints the failure', () => {
    const defect = defectFromResult(
      { caseId: 'c1', title: 'Checkout completes', status: 'failed', errorMessage: 'expected Thanks, got 500' },
      { targetUrl: 'https://acme.example', route: '/checkout', steps: [{ action: 'goto', route: '/checkout' }] },
    );
    expect(defect).toMatchObject({ severity: 'high', defectType: 'assertion', status: 'open', route: '/checkout' });
    expect(defect.actual).toBe('expected Thanks, got 500');
    expect(defect.reproSteps).toEqual([{ action: 'goto', route: '/checkout' }]);
    expect(typeof defect.fingerprint).toBe('string');
  });

  it('gives the same fingerprint to the same failure, so it dedupes', () => {
    const args = [
      { caseId: 'c1', title: 'x', status: 'failed' as const, errorMessage: 'boom' },
      { route: '/a' },
    ] as const;
    expect(defectFromResult(...args).fingerprint).toBe(defectFromResult(...args).fingerprint);
  });
});

describe('planGateVerdict', () => {
  const criteria = { minPassRate: 95, maxOpenDefects: 0, maxSevereDefects: 0, requireAccessibility: true, signOffs: ['QA'] };

  it('is pending — not failed — when the suite has never run', () => {
    const verdict = planGateVerdict({ minPassRate: 95 }, { runs: [], defects: [], audits: [], signOffs: [] });
    expect(verdict.status).toBe('pending');
    expect(verdict.checks[0]?.rule).toBe('hasRun');
  });

  it('fails on the criterion that is actually broken', () => {
    const verdict = planGateVerdict(criteria, {
      runs: [{ passRate: 90, status: 'failed' }],
      defects: [{ severity: 'critical', status: 'open' }],
      audits: [{ passed: true }],
      signOffs: [{ owner: 'QA', approvedAt: '2026-08-13T00:00:00.000Z' }],
    });
    expect(verdict.status).toBe('fail');
    expect(verdict.checks.filter((check) => !check.ok).map((check) => check.rule)).toEqual(['passRate', 'openDefects', 'severeDefects']);
  });

  it('passes when every declared criterion is met, and ignores closed defects', () => {
    const verdict = planGateVerdict(criteria, {
      runs: [{ passRate: 100, status: 'passed' }],
      defects: [{ severity: 'critical', status: 'closed' }],
      audits: [{ passed: true }],
      signOffs: [{ owner: 'qa', approvedAt: '2026-08-13T00:00:00.000Z' }],
    });
    expect(verdict.status).toBe('pass');
    expect(verdict.score).toBe(100);
  });

  it('has no verdict to give when no criteria were declared', () => {
    expect(planGateVerdict({}, { runs: [], defects: [], audits: [], signOffs: [] }).status).toBe('pending');
  });
});

describe('releaseEvidence', () => {
  it('derives the metrics from the board rather than from a typed file', () => {
    const evidence = releaseEvidence(
      { title: '2026.8 release', targetUrl: 'https://acme.example', exitCriteria: { minPassRate: 90 } },
      { runs: [{ passRate: 92, status: 'passed' }], defects: [{ severity: 'low', status: 'open' }], audits: [], signOffs: [] },
      '2026-08-13T10:00:00.000Z',
    );
    expect(evidence).toMatchObject({ release: '2026.8 release', verdict: 'pass', generatedAt: '2026-08-13T10:00:00.000Z' });
    expect(evidence.metrics).toMatchObject({ passRate: 92, runs: 1, openDefects: 1 });
  });
});

describe('coverageReport', () => {
  const nodes = [
    { id: 'prd1', kind: 'prd', title: 'Checkout PRD' },
    { id: 'prd2', kind: 'prd', title: 'Search PRD' },
    { id: 'note1', kind: 'note', title: 'A note' },
    { id: 'case1', kind: 'testCase', title: 'Checkout completes' },
    { id: 'case2', kind: 'testCase', title: 'Orphan case' },
  ];

  it('counts only asserted verifies edges', () => {
    const report = coverageReport(nodes, [
      { source: 'case1', target: 'prd1', connectionKind: 'verifies' },
      // A reference edge must NOT count as coverage.
      { source: 'case2', target: 'prd2', connectionKind: 'reference' },
    ]);
    expect(report.total).toBe(2);
    expect(report.coveragePct).toBe(50);
    expect(report.covered[0]).toMatchObject({ id: 'prd1', verifiedBy: ['Checkout completes'] });
    expect(report.uncovered.map((item) => item.id)).toEqual(['prd2']);
  });

  it('names cases that prove nothing', () => {
    const report = coverageReport(nodes, [{ source: 'case1', target: 'prd1', connectionKind: 'verifies' }]);
    expect(report.orphanCases.map((item) => item.id)).toEqual(['case2']);
  });

  it('reports 0% rather than dividing by zero on a board with nothing coverable', () => {
    expect(coverageReport([{ id: 'n', kind: 'note', title: 'n' }], []).coveragePct).toBe(0);
  });
});

describe('routesFromHtml', () => {
  const html = `
    <a href="/">Home</a>
    <a href="/pricing">Pricing</a>
    <a href="/pricing/">Pricing again</a>
    <a href="https://acme.example/about">About</a>
    <a href="https://other.example/elsewhere">Offsite</a>
    <a href="/login">Log in</a>
    <a href="/logo.svg">Asset</a>
    <a href="/api/health">API</a>
    <a href="mailto:hi@acme.example">Mail</a>
  `;

  it('keeps same-site page routes and drops assets, APIs, auth and offsite links', () => {
    expect(routesFromHtml(html, 'https://acme.example')).toEqual(['/', '/about', '/pricing']);
  });

  it('keeps only root-relative links when no base URL is known', () => {
    expect(routesFromHtml(html)).toEqual(['/', '/pricing']);
  });
});

describe('playwrightSpec — the shared lowering', () => {
  it('never emits an escape hatch the API validator rejects', () => {
    const spec = playwrightSpec({
      name: "Admin's flow",
      steps: [
        { action: 'goto', route: '/admin' },
        { action: 'fill', selector: "testid=name", value: "O'Brien" },
        { action: 'press', value: 'Enter' },
        { action: 'waitFor', selector: '.results' },
      ],
    });
    expect(spec).not.toMatch(/require\(|eval\(|process|fetch\(|page\.evaluate/);
    expect(spec).toContain("test('Admin\\'s flow'");
    expect(spec).toContain("fill('O\\'Brien')");
    expect(spec).toContain("page.keyboard.press('Enter')");
    expect(spec).toContain("page.locator('.results')");
  });

  it('still produces a navigating test when the plan has no goto', () => {
    const spec = playwrightSpec({ name: 'no nav', startRoute: '/dashboard', steps: [] });
    expect(spec).toContain("page.goto('/dashboard')");
  });
});
