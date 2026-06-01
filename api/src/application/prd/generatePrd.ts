/**
 * Generate-PRD workflow spec — PURE logic (no IO).
 *
 * Describes the planning stage that authors a PRD from a raw ticket
 * description. The produced shape mirrors the workflow contract consumed by
 * the orchestrator (workflowType + ordered steps). The 'prd-author' role is
 * referenced by string only — it is NOT registered here.
 */

/** A single step in a generated workflow spec. */
export interface PrdWorkflowStep {
  agentRole:   string;
  description: string;
  dependsOn:   string[];
}

/** The workflow spec describing the generate-PRD planning stage. */
export interface PrdWorkflowSpec {
  workflowType: 'planning';
  steps:        PrdWorkflowStep[];
}

/** Canonical PRD section ids, in document order. */
export function defaultPrdSections(): string[] {
  return ['overview', 'goals', 'requirements', 'acceptance_criteria', 'out_of_scope'];
}

/**
 * Build a planning workflow spec that turns a raw ticket description into a
 * structured PRD. The author step has no dependencies; a review step depends
 * on the author step (referenced by ordinal index for determinism).
 */
export function buildPrdWorkflowSpec(ticketDescription: string): PrdWorkflowSpec {
  const ticket = (ticketDescription ?? '').trim();
  const sections = defaultPrdSections().join(', ');

  return {
    workflowType: 'planning',
    steps: [
      {
        agentRole: 'prd-author',
        description:
          `Author a PRD from the ticket. Produce these sections: ${sections}. ` +
          `Ticket: ${ticket || '(no description provided)'}`,
        dependsOn: [],
      },
      {
        agentRole: 'prd-author',
        description:
          'Review and refine the drafted PRD for completeness across all canonical ' +
          'sections, then mark it ready for freeze.',
        dependsOn: ['0'],
      },
    ],
  };
}
