/**
 * Velocity Gap Types
 * Represents the difference between current team velocity and velocity needed to hit delivery deadlines.
 */

/**
 * Story point value (completion effort)
 */
export type StoryPointValue = number;

/**
 * Time unit for velocity calculations
 */
export type TimeUnit = 'points' | 'hours' | 'days' | 'sprints';

/**
 * Current team velocity metric
 */
export interface CurrentVelocity {
  value: StoryPointValue;
  unit: TimeUnit;
  calculatedOn: string; // ISO date string
  history?: VelocityPoint[]; // Last N points for trend
}

/**
 * Desired velocity needed to hit delivery deadlines
 */
export interface RequiredVelocity {
  value: StoryPointValue;
  unit: TimeUnit;
  deadline: string; // ISO date string
  timeRemaining: number; // Number of units remaining
}

/**
 * A single velocity point calculation
 */
export interface VelocityPoint {
  sprint: string;
  points: number;
  date: string;
  notes?: string;
}

/**
 * Velocity Gap result with explanation
 */
export interface VelocityGapResult {
  gap: number;
  percentage: number; // Gap as percentage of required velocity
  isAhead: boolean; // true if ahead, false if behind
  explanation: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Risk tier for a velocity gap
 */
export type RiskTier = 'green' | 'yellow' | 'orange' | 'red';

/**
 * Recommendations for addressing the gap
 */
export interface VelocityRecommendation {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  effects: {
    current: string;
    projected: string;
  };
  actionType: 'adjust_schedule' | 'hold_stories' | 'split_stories' | 'add_capacity' | 'reprioritize' | 'other';
  estimatedImpact: number; // Story points improvement
}

/**
 * Action plan with milestones
 */
export interface VelocityAction {
  id: string;
  recommendationId: string;
  title: string;
  description: string;
  status: 'planned' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  estimatedCompletion: string;
  actualCompletion?: string;
  owner?: string;
  estimatedSprintsToComplete: number;
}

/**
 * Velocity gap visualization data for charts
 */
export interface VelocityChartSeries {
  label: string;
  color: string;
  data: Array<{ x: string; y: number }>;
  trend?: 'improving' | 'stable' | 'declining';
}

/**
 * Project context for velocity gap calculations
 */
export interface VelocityGapContext {
  projectId: number;
  projectName: string;
  currentScenario: {
    teamVelocity: CurrentVelocity;
    plannedSprintGoals: number;
  };
  requiredScenario: RequiredVelocity;
  availableRoles?: {
    role: string;
    count: number;
    capacity: number;
  }[];
}