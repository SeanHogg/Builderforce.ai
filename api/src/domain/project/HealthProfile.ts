import { ValidationError } from '../shared/errors';

/**
 * Health Profile - structured diagnostic questionnaire answers for a project.
 * 
 * This captures the baseline health assessment from the Diagnostic Question Engine
 * (epic #155), storing user-provided answers about:
 * - Timeline & Deadlines
 * - Budget & Resources  
 * - Quality & Bugs
 * - Risk & Blockers
 * - Team Health
 * - Stakeholder Alignment
 */

export const HEALTH_PROFILE_SCHEMA_VERSION = '1.0';

export interface HealthProfileAnswers {
  /** Timeline & Deadlines - Are we on track? Business vs customer deadlines? */
  timeline?: {
    onTrack: boolean;
    status?: 'green' | 'yellow' | 'red';
    businessDeadlines?: string[];
    customerDeadlines?: string[];
    notes?: string;
    [key: string]: unknown;
  };
  /** Budget & Resources - Is budget on track? Human + AI resource needs? */
  budget?: {
    onTrack: boolean;
    status?: 'green' | 'yellow' | 'red';
    spentPercentage?: number;
    remainingBudget?: number;
    resourceNeeds?: string;
    notes?: string;
    [key: string]: unknown;
  };
  /** Quality & Bugs - Bug count, severity, trend? */
  quality?: {
    status?: 'green' | 'yellow' | 'red';
    openBugs?: number;
    criticalBugs?: number;
    bugTrend?: 'improving' | 'stable' | 'worsening';
    notes?: string;
    [key: string]: unknown;
  };
  /** Risk & Blockers - What's at risk of slipping? Why? */
  risk?: {
    status?: 'green' | 'yellow' | 'red';
    topRisks?: Array<{
      id: string;
      description: string;
      severity: 'high' | 'medium' | 'low';
      likelihood: 'high' | 'medium' | 'low';
    }>;
    blockers?: string[];
    notes?: string;
    [key: string]: unknown;
  };
  /** Team Health - Capacity, burnout, skill gaps? */
  team?: {
    status?: 'green' | 'yellow' | 'red';
    capacityPercentage?: number;
    burnoutRisk?: 'high' | 'medium' | 'low';
    skillGaps?: string[];
    notes?: string;
    [key: string]: unknown;
  };
  /** Stakeholder Alignment - Are priorities clear and agreed? */
  alignment?: {
    status?: 'green' | 'yellow' | 'red';
    priorityClarity?: 'clear' | 'unclear';
    agreementLevel?: 'aligned' | 'partial' | 'misaligned';
    notes?: string;
    [key: string]: unknown;
  };
  /** Additional custom fields captured but not mapped to canonical sections */
  [key: string]: unknown;
}

export interface HealthProfileComputedScores {
  overallScore?: number;
  timelineScore?: number;
  budgetScore?: number;
  qualityScore?: number;
  riskScore?: number;
  teamScore?: number;
  alignmentScore?: number;
}

export interface HealthProfileProps {
  id: string;
  projectId: number;
  schemaVersion: string;
  answers: HealthProfileAnswers;
  computedScores?: HealthProfileComputedScores;
  submittedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HealthProfileVersionProps {
  id: string;
  projectId: number;
  profileId: string;
  schemaVersion: string;
  answers: HealthProfileAnswers;
  computedScores?: HealthProfileComputedScores;
  createdBy: string | null;
  createdAt: Date;
  versionNumber: number;
}

/**
 * Validates health profile answers structure
 */
export function validateHealthProfileAnswers(answers: unknown): answers is HealthProfileAnswers {
  if (!answers || typeof answers !== 'object') {
    throw new ValidationError('Health profile answers must be an object');
  }
  // Basic validation - the structure is flexible to accommodate custom fields
  return true;
}

/**
 * Computes health scores from answers
 * Maps status colors to numeric scores
 */
export function computeHealthScores(answers: HealthProfileAnswers): HealthProfileComputedScores {
  const statusToScore = (status?: 'green' | 'yellow' | 'red'): number => {
    switch (status) {
      case 'green': return 100;
      case 'yellow': return 60;
      case 'red': return 20;
      default: return 50; // neutral/unknown
    }
  };

  const calculateOverall = (scores: number[]): number => {
    if (scores.length === 0) return 50;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  };

  const scores: number[] = [];

  const timelineScore = answers.timeline ? statusToScore(answers.timeline.status) : undefined;
  if (timelineScore !== undefined) scores.push(timelineScore);

  const budgetScore = answers.budget ? statusToScore(answers.budget.status) : undefined;
  if (budgetScore !== undefined) scores.push(budgetScore);

  const qualityScore = answers.quality ? statusToScore(answers.quality.status) : undefined;
  if (qualityScore !== undefined) scores.push(qualityScore);

  const riskScore = answers.risk ? statusToScore(answers.risk.status) : undefined;
  if (riskScore !== undefined) scores.push(riskScore);

  const teamScore = answers.team ? statusToScore(answers.team.status) : undefined;
  if (teamScore !== undefined) scores.push(teamScore);

  const alignmentScore = answers.alignment ? statusToScore(answers.alignment.status) : undefined;
  if (alignmentScore !== undefined) scores.push(alignmentScore);

  return {
    overallScore: calculateOverall(scores),
    timelineScore,
    budgetScore,
    qualityScore,
    riskScore,
    teamScore,
    alignmentScore,
  };
}
