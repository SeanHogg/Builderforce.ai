import { summarizeWorkflow, workflowMetricOf, type WorkflowSummary } from '@builderforce/agent-run';
import type { BrainTraceEvent } from './brainTriage';

/** Match only step rows emitted by the workflow recorder. */
export function isWorkflowSpan(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const { category, label, args } = value as { category?: unknown; label?: unknown; args?: unknown };
  if (category !== 'message' || typeof label !== 'string' || !label.startsWith('workflow.stage.')) return false;
  const metric = workflowMetricOf(args);
  return metric !== null && label === `workflow.stage.${metric.id}.${metric.status}`;
}

/** Read measured spans only. Gaps between trace timestamps are not stage durations. */
export function workflowDiagnostics(events: readonly BrainTraceEvent[]): WorkflowSummary {
  return summarizeWorkflow(events.flatMap((event) => {
    if (event.label !== 'workflow.stage' && !event.label.startsWith('workflow.stage.')) return [];
    const metric = workflowMetricOf(event.args);
    return metric ? [metric] : [];
  }));
}

/** Technical protocol fields and enum values remain verbatim in exported diagnostics. */
export function formatWorkflowDiagnostics(workflow: WorkflowSummary): string[] {
  const row = (stage: string, s: Omit<WorkflowSummary['stages'][number], 'stage'>): string =>
    `| ${stage} | ${s.status} | ${s.attempts} | ${s.completed} | ${s.failed} | ${s.blocked} | ${s.cancelled} | ${s.running} | ${s.totalMs ?? 'null'} | ${s.maxMs ?? 'null'} | ${s.latestCounters ? JSON.stringify(s.latestCounters) : ''} |`;
  return [
    '', '### `workflow.metrics`', '',
    `\`observedStages=${workflow.observedStages}/${workflow.totalStages}\``, '',
    '| stage | status | attempts | completed | failed | blocked | cancelled | running | totalMs | maxMs | latestCounters |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...workflow.stages.flatMap((s) => [row(s.stage, s), ...(s.operations ?? []).map((op) => row(`${s.stage}.${op.operation}`, op))]),
  ];
}
