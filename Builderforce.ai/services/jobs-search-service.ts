/**
 * Jobs Search Service (PRD #380)
 * Implements faceted search over the Jobs table. The real implementation is UPSTREAM with Jobs schema;
 * here we provide a service core that uses the central verification helpers, a mock in-memory store,
 * and a clear structure for later wiring to a real database.
 */

import type {
  ActiveFilterSets,
  JobsQuery,
  JobsResponse,
  Budget,
  Duration,
  ExperienceLevel,
  Discipline,
  SkillsFilter,
  Visibility
} from "../taxonomy/filter-types";
import { verifyJobsRow, computeFilterRequirements } from "../taxonomy/filter-verification";
import type { DataRowVerifier } from "../taxonomy/filter-types";
import { listAllTaxonomy } from "../taxonomy/taxonomy-utils";

/**
 * In-memory mock store for jobs (to demonstrate filtering). Replace with real DB fetch on repo pull-in.
 */
const mockJobsDB: any[] = [
  {
    id: "job-1",
    title: "UI/UX Designer",
    description: "Design user flows and screens for a fintech mobile app.",
    discipline: ["designer", "ui/ux"],
    skills: ["design-ui", "design-brand"],
    budgetBce: 350000,
    hourlyBce: 850000, // 45 USD/hr approx
    durationBce: 12, // weeks
    experienceLevel: "mid-level",
    visibility: "public"
  },
  {
    id: "job-2",
    title: "Brand Identity Designer",
    description: "Create brand identity including logo, color palette, and guidelines.",
    discipline: ["designer", "brand"],
    skills: ["design-identify-brand"],
    budgetBce: 250000,
    hourlyBce: 650000,
    durationBce: 16,
    experienceLevel: "senior",
    visibility: "public"
  },
  {
    id: "job-3",
    title: "Video Editor",
    description: "Edit corporate training videos with motion graphics overlays.",
    discipline: ["video"],
    skills: ["video-edit"],
    budgetBce: 400000,
    hourlyBce: 900000,
    durationBce: 8,
    experienceLevel: "mid-level",
    visibility: "public"
  },
  {
    id: "job-4",
    title: "LLM Fine-tuning Engineer",
    description: "Fine-tune a foundation LLM on proprietary documents for QA extraction.",
    discipline: ["llm"],
    skills: ["llm-finetuning", "llm-rag"],
    budgetBce: 700000,
    hourlyBce: 1100000,
    durationBce: 6,
    experienceLevel: "expert",
    visibility: "public"
  },
  {
    id: "job-5",
    title: "Product Designer",
    description: "Help define and build a product feature using MM12E and design systems.",
    discipline: ["designer"],
    skills: ["designer-product"],
    budgetBce: 320000,
    hourlyBce: 820000,
    durationBce: 12,
    experienceLevel: "mid-level",
    visibility: "public"
  },
  {
    id: "job-6",
    title: "Motion Graphics Designer",
    description: "Create animated graphics for product launch video.",
    discipline: ["video"],
    skills: ["video-motion"],
    budgetBce: 180000,
    hourlyBce: 600000,
    durationBce: 4,
    experienceLevel: "mid-level",
    visibility: "private"
  }
];

/**
 * Applies an ordering and pagination to the result set.
 */
function applyOrderingAndPaginate(
  results: any[],
  query: JobsQuery,
  nConditions: number
): JobsResponse {
  const { limit, offset } = (query as { limit?: number; offset?: number }) || {};
  const page = Math.floor((offset ?? 0) / (limit ?? 20)) + 1;
  const pageSize = limit ?? 20;

  const sorted = results.sort((a, b) => {
    const order = query.orderBy || "relevance";
    if (order === "recent") {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    } else if (order === "budget_low") {
      const ba = a.budgetBce || 0;
      const bb = b.budgetBce || 0;
      return ba - bb;
    } else if (order === "budget_high") {
      const ba = a.budgetBce || 0;
      const bb = b.budgetBce || 0;
      return bb - ba;
    } else if (order === "duration") {
      const da = a.durationBce || 0;
      const db = b.durationBce || 0;
      return da - db;
    }
    // default: no change
    return 0;
  });

  const total = results.length;
  const paginated = sorted.slice(offset ?? 0, (offset ?? 0) + pageSize);

  const appliedFilters = query as ActiveFilterSets;

  return {
    results: paginated,
    total,
    pagination: { page, pageSize },
    appliedFilters
  };
}

/**
 * Checks if filters are valid and populates depth via taxonomy (for future skills labeling).
 */
function validateAndAugmentFilters(filters: ActiveFilterSets) {
  const taxonomySkills = listAllTaxonomy().filter((n) => !n.isCategory);
  // For placeholder; schema will expose skill depths when jobs/freelancers have skill list + taxonomy bindings.
  // A future step will select(l) where l.skills matches one-or-more; skills filters may carry taxonomySkillDepth.
}

/**
 * Core faceted search implementation for Jobs.
 *
 * @param query - JobsQuery containing filters and pagination
 * @returns JobsResponse with results, total, pagination, and appliedFilters
 */
export async function searchJobs(query: JobsQuery): Promise<JobsResponse> {
  // Initialize defaults if not provided
  const activeFilters: ActiveFilterSets = {
    job: query.job || {},
    ...query
  };

  // Validate and enhance the filter set (placeholder hook)
  validateAndAugmentFilters(activeFilters);

  // Compute N conditions for tracking
  const { N_conditions } = computeFilterRequirements(activeFilters);

  // Filter the mock dataset
  const verifier: DataRowVerifier = (filters: ActiveFilterSets, row: any) => verifyJobsRow(filters, row);
  const matched = mockJobsDB.filter((row) => verifier(activeFilters, row));

  // Ordering & pagination
  const response = applyOrderingAndPaginate(matched, query, N_conditions);
  return response;
}

/**
 * Legacy discipline-only search entry (fallback for deployments prior to taxonomy)
 */
export async function searchJobsByDisciplineOnly(discipline: string, limit: number): Promise<JobsResponse> {
  const query: JobsQuery = {
    job: {
      discipline: [discipline]
    },
    limit,
    orderBy: "recent"
  } as JobsQuery;
  return searchJobs(query);
}

/**
 * Fetch all matches for a specific taxonomy skill ID (for UI "skills" facet)
 */
export async function searchJobsBySkill(skillId: string, limit: number = 20): Promise<JobsResponse> {
  const query: JobsQuery = {
    job: {
      skills: [skillId]
    },
    limit
  } as JobsQuery;
  return searchJobs(query);
}