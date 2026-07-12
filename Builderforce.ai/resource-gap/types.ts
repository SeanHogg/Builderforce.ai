/**
 * Resource Gap Analysis Domain Models
 *
 * Self-contained module without external dependencies. Models aligned with PRD FR-1 through FR-8
 * excluding RBAC UI, alerts PMC, and external integrations (HRIS/Jira).
 * Constraints: No real-time payroll, no training content, no hiring workflows.
 */

/**
 * Resource types defined in PRD: people and tools (budget pools)
 */
export enum ResourceType {
  Personnel = 'personnel',
  Tools = 'tools',
  Budget = 'budget',
}

/**
 * Resource dimension categories per PRD
 */
export enum GapDimension {
  Headcount = 'headcount',
  Skills = 'skills',
  CapacityHours = 'capacity_hours', // FTE-hours per period
  Budget = 'budget',
}

/**
 * Four-tier severity model per PRD
 */
export enum GapSeverity {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

/**
 * Recommendation categories per PRD FR-5: hire, upskill/reskill, reallocate, defer, contract
 */
export enum RecommendationType {
  Hire = 'hire',
  Upskill = 'upskill',
  Reskill = 'reskill',
  Reallocate = 'reallocate',
  Defer = 'defer',
  ContractAugment = 'contract_augment',
}

/**
 * Recommendation status (Pending, Accepted, Rejected, InProgress)
 */
export enum RecommendationStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
  InProgress = 'in_progress',
}

/**
 * Gap calculation result (engine output)
 */
export interface GapResult {
  id: string;
  dimension: GapDimension;
  severity: GapSeverity;
  projectId?: string;
  department?: string;
  timeHorizon: 'sprint' | 'monthly' | 'quarterly' | 'annual';
  deficit: number; // Positive where needed > available
  surplus: number; // Positive where available > needed
  principalDescription: string; // Example "1 Missing Senior Engineer"
  principalBreakdown?: Array<{ department?: string; roleName?: string }>;
  createdAt: string; // ISO
  updatedAt: string;
}

/**
 * Recommendation item (generated for a gap)
 */
export interface Recommendation {
  id: string;
  gapId: string;
  type: RecommendationType;
  title: string;
  description: string;
  effortToImplement?: number;
  estimatedCost?: number;
  timeToResolution?: number;
  priority: 'low' | 'medium' | 'high';
  status: RecommendationStatus;
  owner?: string;
  dueDate?: string;
  rationale: string;
}

/**
 * Gap analysis metric summary at closure
 */
export interface GapMetrics {
  totalOpenGaps: number;
  gapsBySeverity: Record<GapSeverity, number>;
  totalDeficitHours?: number; // If CapacityHours was present
}

/**
 * Gap analysis result container (engine output)
 */
export interface GapAnalysisResult {
  queryPeriod?: {
    startDate: string;
    endDate: string;
  };
  timeHorizon: GapResult['timeHorizon'];
  metrics: GapMetrics;
  gaps: GapResult[];
  meta?: {
    generatedAt: string;
    sourceRef?: string;
  };
}

/**
 * Configuration for gap computation
 */
export interface GapConfig {
  timeHorizon: GapResult['timeHorizon'];
  noiseTolerance?: number;
  costRateCurrency?: string; // e.g., 'USD'
}

/**
 * Seed data: resources (people, skills, availability)
 */
export interface ResourceRecord {
  id: string;
  type: ResourceType;
  name: string;
  role: string;
  seniority?: string;
  department?: string;
  skills: string[];
  availability: number; // 0-100
  costRate?: number;
  fteAllocation?: number; // 0-2.0
}

/**
 * Seed data: demand per project (roles, skills, effort/hours, dates)
 */
export interface ResourceDemand {
  id: string;
  projectId: string;
  role: string;
  skills: string[];
  effort: number;
  effortUnits: 'hours' | 'fte-weeks';
  startDate: string;
  endDate: string;
  department?: string;
}