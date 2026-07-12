/**
 * Question bank for the Diagnostic Interview system (FR-2).
 *
 * Implements the three pillars (Status, Risk, Priority) and clarifying follow-ups.
 * Each question carries a relevance predicate that adapts based on prior answers.
 */
import {
  type Question,
  type Pillar,
  type DiagnosticState,
} from './types';

/**
 * Build the initial set of questions for an interview.
 *
 * Questions are ordered within each pillar. The interview engine consumes them
 * one at a time, using the `relevancy` predicate to decide whether to
 * skip ahead. Cold-start path issues questions from all 3 pillars and
 * completes in ≤15 questions (AC-1).
 */
export function buildQuestions(seed?: DiagnosticState['contextSeed']): Question[] {
  const projectRef = seed?.projectName ?? 'this project';

  return [
    // =====================================================================
    // PILLAR: STATUS (FR-2a)
    // =====================================================================
    {
      id: 'status_phase',
      pillar: 'status',
      type: 'open-ended',
      text: `What phase or milestone is ${projectRef} currently in?`,
      label: 'Current Phase/Milestone',
      required: true,
      maxClarifications: 1,
      relevancy: () => true,
    },
    {
      id: 'status_completion',
      pillar: 'status',
      type: 'open-ended',
      text: `Approximately how complete is ${projectRef} (e.g. a percentage or another signal)?`,
      label: 'Completion Signal',
      required: true,
      maxClarifications: 1,
      relevancy: () => true,
    },
    {
      id: 'status_last_deliverable',
      pillar: 'status',
      type: 'open-ended',
      text: `What is the last deliverable or milestone ${projectRef} completed?`,
      label: 'Last Completed Deliverable',
      required: false,
      maxClarifications: 1,
      relevancy: () => true,
    },
    {
      id: 'status_next_deliverable',
      pillar: 'status',
      type: 'open-ended',
      text: `What is the next scheduled deliverable for ${projectRef}?`,
      label: 'Next Scheduled Deliverable',
      required: false,
      maxClarifications: 1,
      relevancy: () => true,
    },

    // =====================================================================
    // PILLAR: RISK (FR-2b)
    // =====================================================================
    {
      id: 'risk_top3',
      pillar: 'risk',
      type: 'sequential',
      text: `What are the top 3 risks currently facing ${projectRef}? Please describe each in one line. (answers can continue on next line if needed)`,
      label: 'Top 3 Risks',
      required: true,
      maxClarifications: 1,
      relevancy: () => true,
    },
    {
      id: 'risk_likelihood_impact',
      pillar: 'risk',
      type: 'rating',
      text: 'For each risk you mentioned, please rate the likelihood (Low/Medium/High) and impact (Low/Medium/High).',
      label: 'Risk Likelihood & Impact',
      required: true,
      maxClarifications: 1,
      relevancy: (state: DiagnosticState) => {
        const risks = state.pillars.risk;
        return !!risks && risks.length > 0;
      },
    },
    {
      id: 'risk_materialized',
      pillar: 'risk',
      type: 'confirm',
      text: 'Has any risk materialized since the last review? If so, which one and what was the impact?',
      label: 'Materialized Risks',
      required: false,
      maxClarifications: 1,
      relevancy: () => true,
    },
    {
      id: 'risk_followup_dependencies',
      pillar: 'risk',
      type: 'open-ended',
      text: 'Are there any dependency risks — blockers from external teams, third-party services, or unplanned work that could delay delivery?',
      label: 'Dependency Risks Probe',
      required: false,
      maxClarifications: 1,
      relevancy: () => true,
    },
    {
      id: 'risk_followup_resourcing',
      pillar: 'risk',
      type: 'open-ended',
      text: 'Are there any resourcing risks — team capacity gaps, turnover risk, or skill shortages?',
      label: 'Resourcing Risks Probe',
      required: false,
      maxClarifications: 1,
      relevancy: (state: DiagnosticState) => {
        const risks = state.pillars.risk;
        return !!risks && risks.length > 0;
      },
    },
    {
      id: 'risk_followup_tech_debt',
      pillar: 'risk',
      type: 'open-ended',
      text: 'Are there technical debt or quality risks — areas where shortcuts or accumulated debt could slow things down?',
      label: 'Technical Debt Probe',
      required: false,
      maxClarifications: 1,
      relevancy: (state: DiagnosticState) => {
        const risks = state.pillars.risk;
        return !!risks && risks.length > 0;
      },
    },

    // =====================================================================
    // PILLAR: PRIORITY (FR-2c)
    // =====================================================================
    {
      id: 'priority_top',
      pillar: 'priority',
      type: 'open-ended',
      text: `What is the top priority item for ${projectRef} over the next 1–2 weeks?`,
      label: 'Top Priority',
      required: true,
      maxClarifications: 1,
      relevancy: () => true,
    },
    {
      id: 'priority_changes',
      pillar: 'priority',
      type: 'confirm',
      text: 'Have any priorities changed since the last review? If so, what shifted?',
      label: 'Priority Changes',
      required: false,
      maxClarifications: 1,
      relevancy: () => true,
    },
    {
      id: 'priority_deprioritize',
      pillar: 'priority',
      type: 'open-ended',
      text: 'Is there any item that should be de-prioritized or paused right now?',
      label: 'Deprioritization',
      required: false,
      maxClarifications: 1,
      relevancy: () => true,
    },
  ];
}

/**
 * Return a map from pillar to the set of question IDs that belong to that pillar.
 */
export function questionIdsByPillar(): Record<Pillar, string[]> {
  const questions = buildQuestions();
  const map: Record<Pillar, string[]> = { status: [], risk: [], priority: [] };
  for (const q of questions) {
    map[q.pillar].push(q.id);
  }
  return map;
}

/**
 * Find a question by its ID.
 */
export function findQuestion(id: string): Question | undefined {
  return buildQuestions().find(q => q.id === id);
}