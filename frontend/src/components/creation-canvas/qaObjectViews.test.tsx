import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreationNode } from './CreationNode';
import type { CreationNodeData } from './types';

/**
 * The QA cards render what a tester needs to READ, in the locale they read it in.
 *
 * These assert the real catalog strings rather than the keys, because the failure
 * these exist to catch is a body that renders a raw `qaStep_goto` — which type-checks,
 * looks like a bug in the data, and is actually a missing translation.
 */
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@xyflow/react', async () => {
  const inert = () => null;
  return {
    Handle: inert, NodeResizer: inert, Position: { Left: 'left', Right: 'right' },
    useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

const nodeProps = {
  id: 'object-1', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
  selectable: true, deletable: true, draggable: true, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
};

function renderNode(data: CreationNodeData) {
  return render(<CreationNode {...nodeProps} data={data} />);
}

describe('test plan card', () => {
  it('states the target, the route count and that no gate was declared', () => {
    renderNode({
      kind: 'testPlan', title: 'Acme site', targetUrl: 'https://acme.example',
      routes: ['/', '/pricing'], exitCriteria: {}, caseCount: 2,
    });
    expect(screen.getByText('https://acme.example')).toBeInTheDocument();
    expect(screen.getByText(/no exit criteria declared/i)).toBeInTheDocument();
    expect(screen.getByText('/pricing')).toBeInTheDocument();
  });

  it('reports a failing gate against the criterion that broke', () => {
    renderNode({
      kind: 'testPlan', title: 'Acme site', targetUrl: 'https://acme.example', routes: ['/'],
      exitCriteria: { minPassRate: 95 },
      gateVerdict: { status: 'fail', score: 0, checks: [{ rule: 'passRate', ok: false, detail: { actual: 80, required: 95 } }] },
    });
    expect(screen.getByText(/release gate failing/i)).toBeInTheDocument();
    expect(screen.getByText(/80% against 95% required/i)).toBeInTheDocument();
  });

  it('asks for a target before it has one, rather than rendering an empty gate', () => {
    renderNode({ kind: 'testPlan', title: 'Test plan', targetUrl: '', routes: [] });
    expect(screen.getByText(/no target yet/i)).toBeInTheDocument();
  });
});

describe('test case card', () => {
  it('renders localized step verbs and the generated source', () => {
    renderNode({
      kind: 'testCase', title: 'Home loads', priority: 'critical',
      steps: [
        { action: 'goto', route: '/' },
        { action: 'click', selector: 'role=button[name=Start]' },
      ],
      spec: "import { test, expect } from '@playwright/test';\ntest('Home loads', async ({ page }) => {});",
    });
    expect(screen.getByText('Go to')).toBeInTheDocument();
    expect(screen.getByText('Click')).toBeInTheDocument();
    expect(screen.getByText('/')).toBeInTheDocument();
    expect(screen.getByText(/@playwright\/test/)).toBeInTheDocument();
    expect(screen.getByText(/2 steps · critical/)).toBeInTheDocument();
  });
});

describe('test run card', () => {
  it('leads with the pass rate and names the failure', () => {
    renderNode({
      kind: 'testRun', title: 'Nightly',
      results: [
        { caseId: 'a', title: 'Home loads', status: 'passed', durationMs: 1200 },
        { caseId: 'b', title: 'Checkout completes', status: 'failed', errorMessage: 'expected Thanks, got 500' },
      ],
    });
    expect(screen.getByText('50% passing')).toBeInTheDocument();
    expect(screen.getByText('Checkout completes')).toBeInTheDocument();
    expect(screen.getByText(/expected Thanks, got 500/)).toBeInTheDocument();
  });
});

describe('defect card', () => {
  it('shows severity, expected vs actual, the repro and what was happening', () => {
    renderNode({
      kind: 'defect', title: 'Checkout 500s', severity: 'critical', defectType: 'network',
      route: '/checkout', expected: 'the order confirms', actual: 'a 500 page',
      reproSteps: [{ action: 'goto', route: '/checkout' }, { action: 'click', selector: 'testid=pay' }],
      journal: [{ at: '2026-08-13T10:00:00.000Z', kind: 'tool', label: 'canvas_add_object', ok: false, detail: 'rejected' }],
    });
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('the order confirms')).toBeInTheDocument();
    expect(screen.getByText('a 500 page')).toBeInTheDocument();
    expect(screen.getByText('canvas_add_object')).toBeInTheDocument();
  });
});

describe('page audit inside a diagnostics card', () => {
  it('renders the failing rules with their WCAG criterion', () => {
    renderNode({
      kind: 'diagnostics', title: 'Audit', auditTarget: 'https://acme.example',
      auditScore: 61, auditPassed: false,
      auditFindings: [
        { rule: 'imageAlt', category: 'accessibility', severity: 'serious', count: 3, wcag: '1.1.1' },
        { rule: 'htmlLang', category: 'accessibility', severity: 'serious', count: 0, wcag: '3.1.1' },
      ],
    });
    expect(screen.getByText('Page score 61/100')).toBeInTheDocument();
    expect(screen.getByText(/Images without alternative text \(WCAG 1\.1\.1\)/)).toBeInTheDocument();
    // A rule that PASSED must not be listed as a finding.
    expect(screen.queryByText(/Page language is not declared/)).not.toBeInTheDocument();
  });

  it('renders nothing at all on a diagnostics object with no audit', () => {
    renderNode({ kind: 'diagnostics', title: 'Editor diagnostics' });
    expect(screen.queryByText(/Page score/)).not.toBeInTheDocument();
  });
});
