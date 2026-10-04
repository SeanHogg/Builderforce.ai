import type { CreationFlowNode } from './CreationNode';
import type { Edge } from '@xyflow/react';
import { type GateEvidence, readTestCases, readTestResults, relowerCase, summarizeRun } from '@/lib/canvasQa';
import { QA_SEVERITIES, type QaFindingSeverity } from '@builderforce/creation-canvas-contract';

/**
 * The evidence a test plan's gate is judged on, gathered from the board.
 *
 * ONE collector, two readers: the `gate` action (which writes the verdict onto the
 * plan) and the JSON export (which hands the same verdict to the release-audit CLI).
 * Two collectors would be two definitions of "an open defect", and the CLI would
 * eventually certify something the board was calling red.
 *
 * Runs and audits must be CONNECTED to the plan — evidence for one release is not
 * evidence for another. Defects are the whole board's, because a defect found
 * anywhere still blocks the thing it was found in.
 */
export function releaseGateEvidence(
  plan: CreationFlowNode,
  nodes: readonly CreationFlowNode[],
  edges: readonly Edge[],
): GateEvidence {
  const connected = new Set(edges.filter((edge) => edge.source === plan.id).map((edge) => edge.target));
  return {
    runs: nodes
      .filter((node) => node.data.kind === 'testRun' && connected.has(node.id))
      .map((node) => ({ ...summarizeRun(readTestResults(node.data.results)), finishedAt: String(node.data.finishedAt ?? '') }))
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
    defects: nodes
      .filter((node) => node.data.kind === 'defect')
      .map((node) => ({
        severity: QA_SEVERITIES.includes(node.data.severity as QaFindingSeverity) ? node.data.severity as QaFindingSeverity : 'medium',
        status: String(node.data.status ?? 'open'),
      })),
    audits: nodes
      .filter((node) => node.data.kind === 'diagnostics' && connected.has(node.id) && Array.isArray(node.data.auditFindings))
      .map((node) => ({ passed: node.data.auditPassed === true })),
    signOffs: (Array.isArray(plan.data.signOffs) ? plan.data.signOffs : []).flatMap((entry) => {
      const record = entry as { owner?: unknown; approvedAt?: unknown };
      return typeof record?.owner === 'string' && typeof record.approvedAt === 'string'
        ? [{ owner: record.owner, approvedAt: record.approvedAt }]
        : [];
    }),
  };
}

/**
 * The Playwright source a QA object exports as.
 *
 * A `testCase` is its own spec. A `testPlan` is every case connected to it, joined
 * into ONE file with a single import — because a suite is taken away as a file, not
 * as one download per card, and because N files each re-importing `@playwright/test`
 * is not what a person would have written.
 *
 * Re-lowered from `steps` rather than trusting the stored `spec` when the two could
 * disagree: `relowerCase` is the single generator, so an edited step list cannot
 * export yesterday's assertions.
 */
export function canvasSpecSource(
  target: CreationFlowNode,
  nodes: readonly CreationFlowNode[],
  edges: readonly Edge[],
): string | null {
  const specOf = (node: CreationFlowNode): string | null => {
    const [restored] = readTestCases([{
      title: node.data.title,
      steps: node.data.steps,
      route: node.data.route,
      spec: node.data.spec,
      priority: node.data.priority,
    }]);
    if (!restored) return null;
    // A stored spec that came back from the QA library (persona-aware, possibly
    // model-written) wins; otherwise the deterministic lowering of the steps.
    return restored.steps.length ? relowerCase(restored).spec : restored.spec;
  };

  if (target.data.kind === 'testCase') return specOf(target);
  if (target.data.kind !== 'testPlan') return null;

  const memberIds = new Set(edges.filter((edge) => edge.source === target.id).map((edge) => edge.target));
  const cases = nodes.filter((node) => node.data.kind === 'testCase' && memberIds.has(node.id));
  const specs = cases.map(specOf).filter((spec): spec is string => !!spec);
  if (!specs.length) return null;
  const bodies = specs.map((spec) => spec.split('\n').filter((line) => !line.startsWith('import ')).join('\n').trim());
  return [`import { test, expect } from '@playwright/test';`, '', ...bodies].join('\n') + '\n';
}
