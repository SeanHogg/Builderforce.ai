/**
 * Filter Verification Logic for Jobs & Freelancers (PRD #380)
 * Implements verification functions FILTERS/checks that operate against any data model
 * to support faceted search (skills, budget, duration, experienceLevel, discipline).
 * No database or models here; only verification primitives ready for later wiring.
 */

import type {
  ActiveFilterSets,
  FilterRequirementScore,
  DataRowVerifier,
  Budget,
  Duration,
  ExperienceLevel,
  Discipline,
  SkillsFilter,
  Visibility
} from "./filter-types";

/**
 * Return a score of required filters (non-optional) applied to this check.
 * Non-required filters are omitted from N_conditions.
 */
export function computeFilterRequirements(filters: ActiveFilterSets): FilterRequirementScore {
  let N_conditions = 0;
  // Jobs filters
  if (filters.job) {
    const j = filters.job;
    if (j.skills?.length) N_conditions++;
    if (j.budget?.minCents != null || j.budget?.maxCents != null) N_conditions++;
    if (j.duration?.minWeeks != null || j.duration?.maxWeeks != null || j.duration?.category) N_conditions++;
    if (j.experienceLevel) N_conditions++;
    if (j.discipline?.length) N_conditions++;
    // Optional: visibility can be ignored for this baseline score
  }
  // Freelancers filters
  if (filters.freelancer) {
    const f = filters.freelancer;
    if (f.skills?.length) N_conditions++;
    if (f.budget?.minCents != null || f.budget?.maxCents != null) N_conditions++;
    if (f.duration?.minWeeks != null || f.duration?.maxWeeks != null || f.duration?.category) N_conditions++;
    if (f.experienceLevel) N_conditions++;
    if (f.discipline?.length) N_conditions++;
  }
  return { N_conditions };
}

/**
 * Verifies a Job data row against the jobs-side filter set.
 * Missing fields return false for those filters (allowing filtering in).
 * Optional filters are ignored if not provided/valid.
 *
 * Accepts any data model; pre-wiring in the tenant will map to concrete jobs schema.
 */
export const verifyJobsRow: DataRowVerifier = (filters: ActiveFilterSets, row: any): boolean => {
  const job = filters.job;
  if (!job) return true; // No jobs-side filters required

  // Skills verification (array IDs from taxonomy)
  if (job.skills && Array.isArray(job.skills) && row.skills) {
    const rowSkills = Array.isArray(row.skills) ? row.skills.map(String) : [String(row.skills)];
    const rowIds = new Set(job.skills);
    const match = rowSkills.some((rs) => rowIds.has(rs.toLowerCase()));
    if (!match) return false;
  }

  // Budget verification (in cents)
  if (job.budget) {
    let ok = true;
    if (job.budget.minCents && row.budgetBce != null && row.budgetBce < job.budget.minCents) ok = false;
    if (job.budget.maxCents && row.budgetBce != null && row.budgetBce > job.budget.maxCents) ok = false;
    if (!ok) return false;
  }

  // Duration verification (weeks)
  if (job.duration) {
    const dur = job.duration;
    const rowDuration = row.durationBce; // placeholder; future: durationBce or durationWl
    if (dur.minWeeks != null && rowDuration != null && rowDuration < dur.minWeeks) return false;
    if (dur.maxWeeks != null && rowDuration != null && rowDuration > dur.maxWeeks) return false;
  }

  // Experience level verification
  if (job.experienceLevel && row.experienceLevel) {
    if (row.experienceLevel.toLowerCase() !== job.experienceLevel.toLowerCase()) return false;
  }

  // Discipline verification (array)
  if (job.discipline && Array.isArray(job.discipline) && row.discipline) {
    const rowDisciplines = Array.isArray(row.discipline)
      ? row.discipline.map(String).map((d) => d.toLowerCase())
      : [String(row.discipline).toLowerCase()];
    const hasMatch = job.discipline.some((jd) => rowDisciplines.includes(jd.toLowerCase()));
    if (!hasMatch) return false;
  }

  // Optional: visibility
  if (job.visibility != null && row.visibility != null) {
    if (job.visibility.toLowerCase() !== row.visibility.toLowerCase()) return false;
  }

  return true;
};

/**
 * Verifies a Freelancer data row against the freelancer-side filter set.
 */
export const verifyFreelancersRow: DataRowVerifier = (filters: ActiveFilterSets, row: any): boolean => {
  const freelancer = filters.freelancer;
  if (!freelancer) return true; // No freelancer filters required

  // Skills verification (array IDs from taxonomy)
  if (freelancer.skills && Array.isArray(freelancer.skills) && row.skills) {
    const rowSkills = Array.isArray(row.skills) ? row.skills.map(String) : [String(row.skills)];
    const rowIds = new Set(freelancer.skills);
    const match = rowSkills.some((rs) => rowIds.has(rs.toLowerCase()));
    if (!match) return false;
  }

  // Budget verification (in cents)
  if (freelancer.budget) {
    let ok = true;
    if (freelancer.budget.minCents != null && row.hourlyBce != null && row.hourlyBce < freelancer.budget.minCents)
      ok = false;
    if (freelancer.budget.maxCents != null && row.hourlyBce != null && row.hourlyBce > freelancer.budget.maxCents)
      ok = false;
    if (!ok) return false;
  }

  // Duration verification (weeks)
  if (freelancer.duration) {
    const dur = freelancer.duration;
    const rowPreferred = row.preferredDurationWl; // placeholder; future: preferredDurationWl or preferredDurationBce
    if (dur.minWeeks != null && rowPreferred != null && rowPreferred < dur.minWeeks) return false;
    if (dur.maxWeeks != null && rowPreferred != null && rowPreferred > dur.maxWeeks) return false;
  }

  // Experience level verification
  if (freelancer.experienceLevel && row.experienceLevel) {
    if (row.experienceLevel.toLowerCase() !== freelancer.experienceLevel.toLowerCase()) return false;
  }

  // Discipline verification (array)
  if (freelancer.discipline && Array.isArray(freelancer.discipline) && row.discipline) {
    const rowDisciplines = Array.isArray(row.discipline)
      ? row.discipline.map(String).map((d) => d.toLowerCase())
      : [String(row.discipline).toLowerCase()];
    const hasMatch = freelancer.discipline.some((fd) => rowDisciplines.includes(fd.toLowerCase()));
    if (!hasMatch) return false;
  }

  return true;
};

/* Default denormalized required filter list for the guild to reference */
export function getRequiredFilterList(): {
  jobs: Array<{
    name: string;
    type: "skills" | "budget" | "duration" | "experience" | "discipline" | "visibility";
  }> {
    return {
      jobs: [
        { name: "Skills from taxonomy", type: "skills" },
        { name: "Budget min/max", type: "budget" },
        { name: "Duration min/max", type: "duration" },
        { name: "Experience Level", type: "experience" },
        { name: "Discipline", type: "discipline" },
        { name: "Visibility (public/private)", type: "visibility" }
      ]
    };
  }
}