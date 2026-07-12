/**
 * Resource Gap Analysis Data Models
 *
 * This file defines the domain models for the Resource Gap Analysis feature.
 * Scope: Model-aligned with PRD FR-1 through FR-8 (excluding RBAC UI, alerts PMC).
 * Constraints: Not real-time payroll/training content, no external hiring workflows.
 */

/**
 * Resource types defined in PRD: people and tools (budget pools)
 */
export enum ResourceType {
  Personnel = 'personnel',
  Tools = 'tools',
  Budget = 'budget'
}

/**
 * Resource dimension categories per PRD
 */
export enum GapDimension {
  Headcount = 'headcount',
  Skills = 'skills',
  CapacityHours = 'capacity_hours',   // FTE-hours per period
  Budget = 'budget'
}

/**
 * Four-tier severity model per PRD
 */
export enum GapSeverity {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low'
}

/**
 * Recommendation categories per PRD FR-5: hire, upskill/–re-skill, reallocate, defer
 */
export enum RecommendationType {
  Hire = 'hire',
  Upskill = 'upskill',
  Reskill = 'reskill',
  Reallocate = 'reallocate',
  Defer = 'defer',
  ContractAugment = 'contract_augment'
}

/**
 * Recommendation status: pending, accepted, rejected, in_progress
 */
export enum RecommendationStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
  InProgress = 'in_progress'
}

/**
 * Base resource record
 */
export interface ResourceRecord {
  id: string;
  type: ResourceType;
  // Standard
  name: string;
  role?: string;
  seniority?: string;
  department?: string;
}

/**
 * Personnel resource fields
 */
export interface PersonnelResource extends ResourceRecord {
  type: ResourceType.Personnel;
  name: string;
  role: string;
  seniority?: string; // e.g., "Junior", "Mid", "Senior"
  department?: string;
  skills: string[]; // Skill names aligned with PRD taxonomy
  availability: number; // 0-100 percentage
  costRate?: number; // Currency (USD). Visible to Finance/Admin only.
  fteAllocation?: number; // 0-2.0 (fractional FTE)
}

/**
 * Tool resource fields (license/platform)
 */
export interface ToolResource extends ResourceRecord {
  type: ResourceType.Tools;
  name: string;
  quantity: number;
  unit: string; // "license", "seat"
  costPerUnit?: number; // Currency
}

/**
 * Non-human resource budget pools (allowed by PRD FR-1)
 */
export interface BudgetPool extends ResourceRecord {
  type: ResourceType.Budget;
  name: string;
  currency: string; // e.g., "USD"
  allocatedAmount: number;
  allocatedTimestamp?: string; // UTC ISO (optional)
  committedToProjectIds?: string[]; // Optional mapping to projects for availability
}

/**
 * Demand requirements per project/workstream
 */
export interface ResourceDemand {
  id: string;
  projectId: string; // Optional if portfolio-wide
  resourceName: string;
  role?: string;
  skills: string[];
  effort: number;
  effortUnits: 'hours' | 'fte-weeks';
  startDate: string; // ISO
  endDate: string; // ISO
  department?: string;
}

/**
 * Brief gap summary
 */
export interface GapSummary {
  id: string;
  dimension: GapDimension;
  severity: GapSeverity;
  projectId?: string;
  department?: string;
  departmentOrRole?: string; // convenience field for tabular columns
  roleName?: string;
  timeHorizon: 'sprint' | 'monthly' | 'quarterly' | 'annual';
  deficit: number; // Positive for gap
  surplus: number; // Positive for over-provisioning
  principalDescription: string; // Example "1 Senior Engineer missing (capacity): -5h/week"
  createdAt: string; // ISO
  updatedAt: string;
}

/**
 * Recommendation item (per-gap)
 */
export interface Recommendation {
  id: string;
  gapId: string;
  type: RecommendationType;
  title: string;
  description: string;
  effortToImplement?: number; // Hours
  estimatedCost: number; // Currency delta
  timeToResolution?: number; // Days
  priority: 'low' | 'medium' | 'high';
  status: RecommendationStatus;
  owner?: string;
  dueDate?: string; // ISO
  rationale: string;
}

/**
 * Gap details for display/detail tools
 */
export interface GapDetail extends GapSummary {
  available: {
    type: 'count' | 'hours' | 'currency';
    value: number;
    breakdown?: { department?: string; count?: number };
  };
  needed: {
    type: 'count' | 'hours' | 'currency';
    value: number;
    details?: ResourceDemand[];
  };
  sourceChangeTimestamp?: string;
  recommendations: Recommendation[];
  overrides?: {
    severity?: GapSeverity;
    overrideReason?: string;
  };
}

/**
 * Gap analysis result container
 */
export interface GapAnalysisResult {
  queryPeriod: {
    startDate: string; // ISO
    endDate: string; // ISO
  };
  timeHorizon: GapSummary['timeHorizon'];
  metrics: {
    totalOpenGaps: number;
    gapsBySeverity: Record<GapSeverity, number>;
    totalDeficitHours?: number; // Computed from capacity_hours deficits only
  };
  gaps: GapSummary[];
  meta?: {
    productionTimestamp?: string; // ISO
    sourceChangeTimestamp?: string;
  };
}