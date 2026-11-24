import { summarizeWorkflow, workflowMetricOf, type WorkflowSummary } from '@builderforce/agent-run';
import type { BrainTraceEvent } from './brainTriage';

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
  return [
    '', '### `workflow.metrics`', '',
    `\`observedStages=${workflow.observedStages}/${workflow.totalStages}\``, '',
    '| stage | status | attempts | completed | failed | blocked | cancelled | running | totalMs | maxMs | latestCounters |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...workflow.stages.map((s) => `| ${s.stage} | ${s.status} | ${s.attempts} | ${s.completed} | ${s.failed} | ${s.blocked} | ${s.cancelled} | ${s.running} | ${s.totalMs ?? 'null'} | ${s.maxMs ?? 'null'} | ${s.latestCounters ? JSON.stringify(s.latestCounters) : ''} |`),
  ];
}
