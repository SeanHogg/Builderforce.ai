/**
 * The editor's `AgentRunsPort` (PRD 46 §3.4): the recent local agent runs and one run's findings, answered by the
 * extension host over the knowledge bridge (`src/knowledge/knowledgeProtocol.ts` ops `agentRuns`, `agentRunReport`).
 *
 * This is where the detector's report (brain-embedded) meets the view's port contract (knowledge-graph-view): the
 * host answers with the detector's types, and returning them as the port's types makes the compiler prove the two are
 * structurally identical — neither package imports the other.
 */

import type { AgentRunsPort } from '@builderforce/knowledge-graph-view';
import type { RunFindingsReport, RunFindingsSummary } from '@seanhogg/builderforce-brain-embedded/runFindings';
import type { KnowledgeTransport } from './hostKnowledgeGraphSource';

export function hostAgentRuns(t: KnowledgeTransport): AgentRunsPort {
  return {
    list: () => t.call<RunFindingsSummary[]>({ op: 'agentRuns' }),
    report: (id) => t.call<RunFindingsReport | null>({ op: 'agentRunReport', id }),
  };
}
