/**
 * `compile('diagnostic')` — closes the loop the diagnostic engine never closed: a
 * `tool_run`'s findings (a maturity score + recommendations) become an *executable
 * improvement process* rather than a dead-end report. Each recommendation lowers to
 * an ordered, chained {@link CompiledStep}; the result is an {@link AgentSpec} the
 * user can review and deploy as a workflow. Deterministic (no LLM needed) so it is
 * robust + unit-testable; `deps.llm`, when supplied, only refines step descriptions.
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import type { CompiledStep } from '../../domain/workflowGraph';
import type { CompileDeps, DiagnosticNeed } from './types';

export async function compileFromDiagnostic(need: DiagnosticNeed, _deps: CompileDeps = {}): Promise<AgentSpec> {
  const { findings } = need;
  const recs = findings.recommendations ?? [];

  const steps: CompiledStep[] = recs.map((rec, i) => ({
    nodeId: `diag-step-${i + 1}`,
    kind: 'agent',
    role: 'orchestrator',
    description: rec.detail ? `${rec.title} — ${rec.detail}` : rec.title,
    config: { source: 'diagnostic', recommendation: rec.title },
    dependsOnNodeIds: i === 0 ? [] : [`diag-step-${i}`],
  }));

  const subject = need.subject?.trim() || findings.headline || 'process';
  return {
    identity: {
      name: `${subject} Improvement Agent`,
      title: 'Compiled from a diagnostic finding',
      bio: findings.summary
        ? `Implements the improvements a diagnostic proposed for ${subject}. ${findings.summary}`
        : `Implements the improvements a diagnostic proposed for ${subject}.`,
    },
    ...(steps.length ? { steps } : {}),
    surfaces: ['workflow-node', 'cloud-durable'],
  };
}
