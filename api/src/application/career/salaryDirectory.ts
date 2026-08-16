/**
 * The browsable salary guide — `/salary/<role>` and `/salary/<role>/<city>`.
 *
 * ── WHY A DIRECTORY AND NOT JUST THE CALCULATOR ──────────────────────────────────
 * `analyzeSalary` already answers "what should this role pay here" for any free-text
 * discipline and location, and `/tools/salary-calculator` serves exactly that. What it
 * cannot be is a PAGE — a free-text lookup has no URL, so it cannot be linked, crawled
 * or shared, and four of the ported hired.video articles link to a salary page rather
 * than a calculator for precisely that reason.
 *
 * So this module adds the one thing missing: a bounded, named catalog of the roles and
 * cities that get their own address. Every NUMBER still comes from `analyzeSalary` —
 * there is no second model of compensation here, and a change to the anchors moves the
 * guide and the calculator together.
 *
 * The catalog is DATA. A new role or city is a row, not a branch or a route.
 */
import { analyzeSalary, type SalaryAnalysis, type Seniority } from './compensation';

export interface SalaryRole {
  /** URL segment. Stable — it is a published address. */
  slug: string;
  title: string;
  /** What gets handed to `analyzeSalary`, which matches it against its anchor table. */
  discipline: string;
  family: string;
}

export interface SalaryCity {
  slug: string;
  name: string;
  /** The location string `analyzeSalary`'s region matcher recognises. */
  query: string;
  /** Shown on the role page so a reader can see WHY two cities differ. */
  region: string;
}

/** The roles with their own page. Ordered by how often they are searched for. */
export const SALARY_ROLES: readonly SalaryRole[] = [
  { slug: 'software-engineer', title: 'Software Engineer', discipline: 'software engineer', family: 'Engineering' },
  { slug: 'frontend-engineer', title: 'Frontend Engineer', discipline: 'frontend', family: 'Engineering' },
  { slug: 'backend-engineer', title: 'Backend Engineer', discipline: 'backend', family: 'Engineering' },
  { slug: 'devops-engineer', title: 'DevOps Engineer', discipline: 'devops', family: 'Engineering' },
  { slug: 'security-engineer', title: 'Security Engineer', discipline: 'security', family: 'Engineering' },
  { slug: 'qa-engineer', title: 'QA Engineer', discipline: 'qa', family: 'Engineering' },
  { slug: 'data-scientist', title: 'Data Scientist', discipline: 'data scientist', family: 'Data' },
  { slug: 'data-engineer', title: 'Data Engineer', discipline: 'data engineer', family: 'Data' },
  { slug: 'data-analyst', title: 'Data Analyst', discipline: 'analyst', family: 'Data' },
  { slug: 'product-manager', title: 'Product Manager', discipline: 'product manager', family: 'Product' },
  { slug: 'project-manager', title: 'Project Manager', discipline: 'project manager', family: 'Product' },
  { slug: 'ux-designer', title: 'UX Designer', discipline: 'ux designer', family: 'Design' },
  { slug: 'product-designer', title: 'Product Designer', discipline: 'product designer', family: 'Design' },
  { slug: 'marketing-manager', title: 'Marketing Manager', discipline: 'marketing', family: 'Go-to-market' },
  { slug: 'account-executive', title: 'Account Executive', discipline: 'account executive', family: 'Go-to-market' },
  { slug: 'recruiter', title: 'Recruiter', discipline: 'recruiter', family: 'People' },
];

/** The cities with their own page. Every `query` must hit `REGION_MULTIPLIER`. */
export const SALARY_CITIES: readonly SalaryCity[] = [
  { slug: 'san-francisco', name: 'San Francisco', query: 'San Francisco', region: 'San Francisco Bay Area' },
  { slug: 'new-york', name: 'New York', query: 'New York', region: 'New York' },
  { slug: 'seattle', name: 'Seattle', query: 'Seattle', region: 'Seattle' },
  { slug: 'austin', name: 'Austin', query: 'Austin', region: 'Major US metro' },
  { slug: 'denver', name: 'Denver', query: 'Denver', region: 'Major US metro' },
  { slug: 'boston', name: 'Boston', query: 'Boston', region: 'Major US metro' },
  { slug: 'los-angeles', name: 'Los Angeles', query: 'Los Angeles', region: 'Major US metro' },
  { slug: 'london', name: 'London', query: 'London', region: 'London' },
  { slug: 'berlin', name: 'Berlin', query: 'Berlin', region: 'Western Europe' },
  { slug: 'amsterdam', name: 'Amsterdam', query: 'Amsterdam', region: 'Western Europe' },
  { slug: 'toronto', name: 'Toronto', query: 'Toronto', region: 'Canada' },
  { slug: 'sydney', name: 'Sydney', query: 'Sydney', region: 'Australia' },
  { slug: 'singapore', name: 'Singapore', query: 'Singapore', region: 'Developed APAC' },
  { slug: 'bangalore', name: 'Bangalore', query: 'Bangalore', region: 'India' },
];

/** The seniorities a guide page breaks down. Deliberately not all nine — a page
 *  listing "intern" beside "executive" answers nobody's question. */
const GUIDE_SENIORITIES: readonly Seniority[] = ['junior', 'mid', 'senior', 'staff', 'director'];

export const findSalaryRole = (slug: string): SalaryRole | undefined =>
  SALARY_ROLES.find((r) => r.slug === slug);

export const findSalaryCity = (slug: string): SalaryCity | undefined =>
  SALARY_CITIES.find((c) => c.slug === slug);

export interface SalaryCityRow {
  slug: string;
  name: string;
  region: string;
  low: number;
  median: number;
  high: number;
  /** Percent difference from the national (no-region) median, for the "vs national" column. */
  vsNational: number;
}

export interface SalaryRoleGuide {
  role: SalaryRole;
  currency: string;
  /** The no-region band — the baseline every city is compared against. */
  national: { low: number; median: number; high: number };
  cities: SalaryCityRow[];
  seniorities: Array<{ seniority: Seniority; low: number; median: number; high: number }>;
}

export interface SalaryCityGuide {
  role: SalaryRole;
  city: SalaryCity;
  currency: string;
  analysis: SalaryAnalysis;
  seniorities: Array<{ seniority: Seniority; low: number; median: number; high: number }>;
  /** The same role in the other cities, so a page is a comparison and not a dead end. */
  otherCities: SalaryCityRow[];
}

const band = (analysis: SalaryAnalysis) => ({
  low: analysis.band.low,
  median: analysis.band.median,
  high: analysis.band.high,
});

const seniorityBands = (discipline: string, location?: string) =>
  GUIDE_SENIORITIES.map((seniority) => ({
    seniority,
    ...band(analyzeSalary({ discipline, seniority, location })),
  }));

const cityRows = (role: SalaryRole, nationalMedian: number): SalaryCityRow[] =>
  SALARY_CITIES.map((city) => {
    const analysis = analyzeSalary({ discipline: role.discipline, seniority: 'mid', location: city.query });
    const b = band(analysis);
    return {
      slug: city.slug,
      name: city.name,
      region: city.region,
      ...b,
      vsNational: nationalMedian > 0 ? Math.round(((b.median - nationalMedian) / nationalMedian) * 100) : 0,
    };
  }).sort((a, b) => b.median - a.median);

/** The role overview: a national band, every city compared against it, and the ladder. */
export function salaryRoleGuide(roleSlug: string): SalaryRoleGuide | null {
  const role = findSalaryRole(roleSlug);
  if (!role) return null;
  const national = analyzeSalary({ discipline: role.discipline, seniority: 'mid' });
  return {
    role,
    currency: national.band.currency,
    national: band(national),
    cities: cityRows(role, national.band.median),
    seniorities: seniorityBands(role.discipline),
  };
}

/** One role in one city: the full analysis, the ladder, and the other cities. */
export function salaryCityGuide(roleSlug: string, citySlug: string): SalaryCityGuide | null {
  const role = findSalaryRole(roleSlug);
  const city = findSalaryCity(citySlug);
  if (!role || !city) return null;
  const analysis = analyzeSalary({ discipline: role.discipline, seniority: 'mid', location: city.query });
  const national = analyzeSalary({ discipline: role.discipline, seniority: 'mid' });
  return {
    role,
    city,
    currency: analysis.band.currency,
    analysis,
    seniorities: seniorityBands(role.discipline, city.query),
    otherCities: cityRows(role, national.band.median).filter((c) => c.slug !== city.slug),
  };
}

/** Every published salary address — the sitemap and the index page both read this. */
export function salaryDirectory(): { roles: SalaryRole[]; cities: SalaryCity[] } {
  return { roles: [...SALARY_ROLES], cities: [...SALARY_CITIES] };
}
