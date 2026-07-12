/**
 * Freelancers Search Service (PRD #380)
 * Faceted search implementation for freelancers using the same verification helpers, pagination and ordering shapes,
 * and local Routing behavior (forward-limit). Includes a stash of Public/Guild/User/Employee-type Engagement Tiers.
 */

import type {
  ActiveFilterSets,
  FreelancersQuery,
  FreelancersResponse,
  Budget,
  Duration,
  ExperienceLevel,
  Discipline,
  SkillsFilter
} from "../taxonomy/filter-types";
import { verifyFreelancersRow, computeFilterRequirements } from "../taxonomy/filter-verification";
import type { DataRowVerifier } from "../taxonomy/filter-types";
import { listAllTaxonomy } from "../taxonomy/taxonomy-utils";

/* -------------------------------------------------------------------------
Execution Modes / Engagement Types — exported for later service coherence
------------------------------------------------------------------------- */
export type EngagementMode = "Public" | "Guild" | "User" | "Employee" | null;
export type EngagementTier = "Potential-tenant-guild" | "EFT-training" | "Contract" | "FTE" | "Guild-member" | null;

/**
 * In-memory mock store for freelancers (to demonstrate filtering). Replace with real DB fetch on repo pull-in.
 */
const mockFreelancersDB: any[] = [
  {
    id: "free-1",
    name: "Alex Rivera",
    discipline: ["designer", "ui/ux"],
    skills: ["design-ui"],
    hourlyBce: 800000,
    budgetBce: 4800000,
    experienceLevel: "mid-level",
    preferredDurationWl: 12,
    availabilityState: "Open"
  },
  {
    id: "free-2",
    name: "Chen Zhang",
    discipline: ["video"],
    skills: ["video-edit"],
    hourlyBce: 1100000,
    budgetBce: 6600000,
    experienceLevel: "senior",
    preferredDurationWl: 16,
    availabilityState: "Open"
  },
  {
    id: "free-3",
    name: "Moira Jenkins",
    discipline: ["designer"],
    skills: ["designer-product"],
    hourlyBce: 950000,
    budgetBce: 5700000,
    experienceLevel: "senior",
    preferredDurationWl: 12,
    availabilityState: "Open"
  },
  {
    id: "free-4",
    name: "Tommy O'Connor",
    discipline: ["llm"],
    skills: ["llm-finetuning"];
    hourlyBce: 1250000,
    budgetBce: 7500000,
    experienceLevel: "expert",
    preferredDurationWl: 20,
    availabilityState: "Open"
  }
];

/* -------------------------------------------------------------------------
Pagination & Ordering (shared shape with JobsService)
------------------------------------------------------------------------- */
type Pagination = { page: number; pageSize: number };
type Ordering = { orderBy: "relevance" | "recent" | "hourly" | "engagement"; direction: "asc" | "desc" };

function applyOrderingAndPaginate(
  results: any[],
  activeFilters: ActiveFilterSets,
  pagination?: Pagination,
  ordering?: Ordering
): FreelancersResponse {
  // defaults
  const page = (pagination?.page ?? 1) - 1;
  const pageSize = pagination?.pageSize ?? 20;
  const offset = page * pageSize;
  const direction = ordering?.direction ?? "desc";

  const sortFn = (a: any, b: any) => {
    const mode = ordering?.orderBy ?? "recent";
    if (mode === "recent") {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return direction === "asc" ? ta - tb : tb - ta;
    } else if (mode === "hourly" || mode === "engagement") {
      // Hourly approx via hourlyBce; we treat engagementMode affinity via a heuristic (null/"/" last)
      const vA = a.hourlyBce ?? (mode === "engagement" ? (a.engagementMode as string | null)?.length ?? 0 : 0);
      const vB = b.hourlyBce ?? (mode === "engagement" ? (b.engagementMode as string | null)?.length ?? 0 : 0);
      return direction === "asc" ? vA - vB : vB - vA;
    }
    // fallback
    return 0;
  };

  const sorted = results.sort(sortFn);
  const total = results.length;
  const paginated = sorted.slice(offset, offset + pageSize);

  const appliedFilters = activeFilters;

  return {
    results: paginated,
    total,
    pagination: {
      page: page + 1,
      pageSize
    },
    appliedFilters
  };
}

/* -------------------------------------------------------------------------
Validation (placeholder; expose depth when schemas arrive)
------------------------------------------------------------------------- */
function validateAndAugmentFilters(filters: ActiveFilterSets) {
  const taxonomySkills = listAllTaxonomy().filter((n) => !n.isCategory);
  // Future: attach taxonomySkillDepth when jobs/freelancers expose skill list/metadata.
}

/* -------------------------------------------------------------------------
Core search + refactor operations
------------------------------------------------------------------------- */
export async function searchFreelancers(query: FreelancersQuery): Promise<FreelancersResponse> {
  const activeFilters: ActiveFilterSets = {
    freelancer: query.freelancer || {},
    ...query
  };

  validateAndAugmentFilters(activeFilters);

  const { N_conditions } = computeFilterRequirements(activeFilters);

  const verifier: DataRowVerifier = (filters: ActiveFilterSets, row: any) => verifyFreelancersRow(filters, row);
  const matched = mockFreelancersDB.filter((row) => verifier(activeFilters, row));

  const pagination = { page: 1, pageSize: 20 }; // default
  const ordering: Ordering = { orderBy: "recent", direction: "desc" };

  const response = applyOrderingAndPaginate(matched, activeFilters, pagination, ordering);
  return response;
}

/* -------------------------------------------------------------------------
Legacy discipline-only route
------------------------------------------------------------------------- */
export async function searchFreelancersByDisciplineOnly(discipline: string, limit: number): Promise<FreelancersResponse> {
  const query: FreelancersQuery = {
    freelancer: {
      discipline: [discipline]
    },
    limit
  } as FreelancersQuery;
  return searchFreelancers(query);
}

/* -------------------------------------------------------------------------
Taxonomy-faceted helpers
------------------------------------------------------------------------- */
export async function searchFreelancersBySkill(skillId: string, limit: number = 20): Promise<FreelancersResponse> {
  const query: FreelancersQuery = {
    freelancer: {
      skills: [skillId]
    },
    limit
  } as FreelancersQuery;
  return searchFreelancers(query);
}

/* -------------------------------------------------------------------------
Route-friendly entry with optional service-like routing (Stub behavior)
------------------------------------------------------------------------- */
export async function routeFreelancersToCall(
  filters?: ActiveFilterSets["freelancer"],
  accessTier?:
    | "Public"
    | "Guild"
    | "User"
    | "Employee"
    | null,
  engagementTier?:
    | "Potential-tenant-guild"
    | "EFT-training"
    | "Contract"
    | "FTE"
    | "Guild-member"
    | null,
  limit?: number
): Promise<FreelancersResponse> {
  // Coalesce defaults and assign to consistent /page shapes for API contract
  const mode: EngagementMode = accessTier ?? null;
  // Later: bind to Business Unit <-> Employee tiers (EFT/Guild/Gateways)

  const query: FreelancersQuery = {
    freelancer: filters || {}
  } as FreelancersQuery;

  const response = await searchFreelancers(query);
  return response;
}