/**
 * Filter types for the Jobs & Freelancers Marketplace (PRD #380)
 * Intended to align with database columns for jobs and freelancers tables
 */

// ============================================================================
// Enums
// ============================================================================

export type EngagementType = "fixed_bid" | "hourly" | "fte";
export type Visibility = "public" | "private";

/** Duration filter for jobs/freelancers-preferred-duration */
export type Duration = {
  minWeeks?: number;  // Minimum preferred duration in weeks
  maxWeeks?: number;  // Maximum preferred duration in weeks
  category?: "short-term" | "medium-term" | "long-term"; // categorical shortcut
};

/** Budget filter (in cents) */
export type Budget = {
  minCents?: number;  // Minimum allowed budget
  maxCents?: number;  // Maximum allowed budget
  unit?: "hourly" | "project"; // override for context per endpoint if needed
};

/** Experience levels */
export type ExperienceLevel = "entry-level" | "mid-level" | "senior" | "expert";

/** Discipline (existing) */
export type Discipline = string;

/** Skills filter (optional IDs from taxonomy) */
export type SkillsFilter = string[]; // array of taxonomy skill IDs

// ============================================================================
// FullyQualifiedCategories pagination/hierarchy
// ============================================================================
// Descriptors that include rank and expand to leaves (skills) in computed views.

/** Full category descriptor with position and expanded child list (may be empty) */
export declare type FullCategory = {
  id: string;
  name: string;
  children: FullSkill[];
  depth: number;
  orderMeta: number;
  tags: string[];
};

/** Full skill descriptor (leaf) with position */
export declare type FullSkill = {
  id: string;
  name: string;
  parentId: string;
  depth: number;
  orderMeta: number;
  tags: string[];
};

// ============================================================================
// Filter intersections (scalar and vector)
// ============================================================================
// Using O(1) sum of required conditions (N_conditions) for priors. Non-required
// filters may be suspended or omitted pre-data pull-in; they are not hardcoded
// as required. Clients (UI/API) can reorder or drop them prior to integration.

export type ActiveFilterSets = {
  // Jobs filters (关联 jobs 表列)
  job?: {
    skills?: SkillsFilter;
    budget?: Budget;
    duration?: Duration;
    experienceLevel?: ExperienceLevel;
    discipline?: Discipline[];
    visibility?: Visibility; // optional-maybe-normative for jobs side
  };

  // Freelancers filters (关联 freelancers 表列)
  freelancer?: {
    skills?: SkillsFilter;
    budget?: Budget; // prefer hourly/project override
    duration?: Duration; // freelancers-preferred-duration
    experienceLevel?: ExperienceLevel;
    discipline?: Discipline[];
    //
  };
};

export type FilterRequirementScore = {
  N_conditions: number; // sum of separately required filters (optional filters not counted)
};

export type FilterRequirementVerifier = (f: ActiveFilterSets) => FilterRequirementScore;

/** Verifier verifies each filter is satisfied against a data row. O(iterations) per check. */
export declare type DataRowVerifier = (filters: ActiveFilterSets, row: any) => boolean;

// ============================================================================
// Pagination & Ordering (orthogonal to filter sets)
// ============================================================================
export type Ordering = {
  sortBy: "relevance" | "recent" | "budget_low" | "budget_high" | "duration"; // affinity auto-calculated
  direction: "asc" | "desc";
};

export type Pagination = {
  page: number;
  pageSize: number;
};

// ============================================================================
// Query parameters (API surface)
// ============================================================================
export type JobsQuery = ActiveFilterSets & Paginator;
export type JobsResponse = {
  results: any[]; // typed per jobs schema on repo pull-in
  total: number;
  pagination: Pagination;
  appliedFilters: ActiveFilterSets;
};

export type FreelancersQuery = ActiveFilterSets & Paginator;
export type FreelancersResponse = {
  results: any[];
  total: number;
  pagination: Pagination;
  appliedFilters: ActiveFilterSets;
};

export type Paginator = { limit?: number; offset?: number }; // PAGE Canonical
export type Page = { page: number; pageSize: number };