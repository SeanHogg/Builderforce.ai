/**
 * Domain models for Resource Gap Analysis (aligned with PRD FR-1 through FR-5)
 *
 * Capped to data-only surfaces; excludes RBAC/UI, alerts PMC, and integrators (HRIS, Jira, etc.).
 * Implements a pure domain layer that can be consumed for AC-1..AC-3 test setup.
 */

/**
 * Resource types: people and tools (budget pools)
 */
export enum ResourceType {
  Personnel = 'personnel',
  Tools = 'tools',
  Budget = 'budget',
}

/**
 * Gap dimension categories per PRD FR-3
 */
export enum GapDimension {
  Headcount = 'headcount',
  Skills = 'skills',
  CapacityHours = 'capacity_hours',
  Budget = 'budget',
}

/**
 * Four-tier severity model per PRD FR-4
 */
export enum GapSeverity {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

/**
 * Recommendation categories per PRD FR-5: hire, upskill, reskill, reallocate, defer, contract-augment
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
 * Recommendation status per PRD FR-5
 */
export enum RecommendationStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
  InProgress = 'in_progress',
}

/**
 * Gap calculation result (engine output) aligned with PRD FR-3
 */
export interface GapResult {
  id: string;
  dimension: GapDimension;
  severity: GapSeverity;
  projectId?: string;
  department?: string;
  timeHorizon: 'sprint' | 'monthly' | 'quarterly' | 'annual';
  deficit: number; // Positive when needed > available
  surplus: number; // Positive when available > needed
  principalDescription: string;
  principalBreakdown?: Array<{ department?: string; roleName?: string }>;
  createdAt: string; // ISO
  updatedAt: string;
}

/**
 * Recommendation item (generator output) aligned with PRD FR-5
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
 * Gap analysis metric summary (internal consumption in engine; can be surfaced to UI later)
 */
export interface GapMetrics {
  totalOpenGaps: number;
  gapsBySeverity: Record<GapSeverity, number>;
  totalDeficitHours?: number;
}

/**
 * Gap analysis result container (public API: combines engine + generator outputs)
 */
export interface GapAnalysisResult {
  queryPeriod?: {
    startDate: string;
    endDate: string;
  };
  timeHorizon: GapResult['timeHorizon'];
  metrics: GapMetrics;
  gaps: GapResult[];
  recommendations: Recommendation[];
  meta?: {
    generatedAt: string;
    sourceRef?: string;
  };
}

/**
 * Configuration for gap computation (consistent with PRD FR-3 and AC-1 assumptions)
 */
export interface GapConfig {
  timeHorizon: GapResult['timeHorizon'];
  costRateCurrency?: string; // e.g., 'USD'
  noiseTolerance?: number; // Float fraction to which small gaps are trimmed; tuned in engine
}

/**
 * Seed data: resources (people, skills, availability, etc.)
 * Aligned with PRD FR-1
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
 * Seed data: demand per project/workstream (roles, skills, effort, dates)
 * Aligned with PRD FR-2
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