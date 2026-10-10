/**
 * The sample workspace's PLANNING TIER — the portfolio, initiatives, objectives
 * and key results that sit above the three sample projects.
 *
 * Every `/api/pmo/*` read a guest can fire (the tree, the value stream, the
 * planning spine and the four segment trackers) describes the SAME hierarchy, so
 * it is declared once here and each wire adapter projects it. Before this the
 * tree fixture typed its portfolio and initiatives inline, which is how a value
 * stream ends up drawing an initiative the tree has never heard of.
 *
 * Domain shapes only, offsets in days — same rules as `sampleWorkspace`.
 */

import { SAMPLE_PROJECTS, type DayOffset, type SampleProject } from './sampleWorkspace';

export type SampleCostClass = 'capex' | 'opex';

export interface SamplePortfolio {
  id: string;
  name: string;
  description: string;
  status: 'active';
  targetDayOffset: DayOffset;
}

export interface SampleInitiative {
  id: string;
  /** The ONE sample project this initiative carries. */
  project: SampleProject;
  portfolioId: string;
  targetDayOffset: DayOffset;
  /** New build is capitalised; keeping the lights on is expensed. */
  costClass: SampleCostClass;
}

export interface SampleObjective {
  id: string;
  title: string;
  description: string;
  portfolioId: string;
  /** The initiative this objective is delivered through (the OKR lineage edge). */
  initiativeId: string;
  startDayOffset: DayOffset;
  endDayOffset: DayOffset;
}

export interface SampleKeyResult {
  id: string;
  objectiveId: string;
  title: string;
  metricType: 'percentage' | 'number';
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string | null;
}

export interface SampleDependency {
  id: string;
  /** The initiative that must land first. */
  fromInitiativeId: string;
  /** The initiative it holds up. */
  toInitiativeId: string;
}

export const SAMPLE_PORTFOLIO: SamplePortfolio = {
  id: 'sample-portfolio-1',
  name: 'FY Commerce Platform',
  description: 'Everything the storefront and the platform teams are accountable for this year.',
  status: 'active',
  targetDayOffset: 120,
};

/** Which projects are new build. Everything else is run-the-business. */
const CAPEX_PROJECT_KEYS: ReadonlySet<string> = new Set(['SHOP']);

/** One initiative per sample project, so the tree has real edges rather than a
 *  flat list — a hierarchy view with no hierarchy in it demonstrates nothing. */
export const SAMPLE_INITIATIVES: SampleInitiative[] = SAMPLE_PROJECTS.map((project, index) => ({
  id: `sample-initiative-${project.id}`,
  project,
  portfolioId: SAMPLE_PORTFOLIO.id,
  targetDayOffset: 45 + index * 30,
  costClass: CAPEX_PROJECT_KEYS.has(project.key) ? 'capex' : 'opex',
}));

/**
 * Reliability lands before the storefront relaunch — one edge, so the value
 * stream draws a critical path. With fewer than two initiatives there is nothing
 * to depend on and the list is correctly empty rather than self-referential.
 */
export const SAMPLE_DEPENDENCIES: SampleDependency[] = SAMPLE_INITIATIVES.length >= 2
  ? [{
      id: 'sample-dependency-1',
      fromInitiativeId: SAMPLE_INITIATIVES[1].id,
      toInitiativeId: SAMPLE_INITIATIVES[0].id,
    }]
  : [];

export const SAMPLE_OBJECTIVES: SampleObjective[] = SAMPLE_INITIATIVES.length > 0
  ? [{
      id: 'sample-objective-1',
      title: 'Make checkout the fastest in the category',
      description: 'Fewer steps, saved payment methods and express wallets — measured on conversion, not on tickets closed.',
      portfolioId: SAMPLE_PORTFOLIO.id,
      initiativeId: SAMPLE_INITIATIVES[0].id,
      startDayOffset: -30,
      endDayOffset: 60,
    }]
  : [];

export const SAMPLE_KEY_RESULTS: SampleKeyResult[] = SAMPLE_OBJECTIVES.length > 0
  ? [
      {
        id: 'sample-key-result-1',
        objectiveId: SAMPLE_OBJECTIVES[0].id,
        title: 'Checkout conversion',
        metricType: 'percentage',
        startValue: 2.1,
        targetValue: 3.5,
        currentValue: 2.8,
        unit: '%',
      },
      {
        id: 'sample-key-result-2',
        objectiveId: SAMPLE_OBJECTIVES[0].id,
        title: 'Median checkout time (seconds)',
        metricType: 'number',
        startValue: 94,
        targetValue: 45,
        currentValue: 61,
        unit: 's',
      },
    ]
  : [];

// ---------------------------------------------------------------------------
// The innovation funnel — ideas and where each one stands
// ---------------------------------------------------------------------------

/** The linear funnel order, as the API declares it. `killed` is an off-ramp. */
export const SAMPLE_FUNNEL_STAGES = ['idea', 'validated', 'in_build', 'shipped', 'measured'] as const;
export type SampleFunnelStage = (typeof SAMPLE_FUNNEL_STAGES)[number];

export interface SampleIdea {
  id: string;
  title: string;
  /** The sample project the idea became, when it got that far. */
  projectKey: string | null;
  stage: SampleFunnelStage | 'killed';
  createdDayOffset: DayOffset;
  /** When it entered its CURRENT stage. */
  stageEnteredDayOffset: DayOffset;
}

/**
 * The ideas behind the boards. Each one that reached build names the work it
 * became, so the funnel and the tickets tell one story: express wallets are in
 * build (SHOP-1), checkout alerting shipped (PLAT-1), the same-day delivery
 * session is the idea a guest is validating right now.
 */
export const SAMPLE_IDEAS: SampleIdea[] = [
  { id: 'sample-idea-1', title: 'Same-day local delivery add-on', projectKey: null, stage: 'validated', createdDayOffset: -6, stageEnteredDayOffset: -4 },
  { id: 'sample-idea-2', title: 'Express wallets at checkout', projectKey: 'SHOP', stage: 'in_build', createdDayOffset: -60, stageEnteredDayOffset: -34 },
  { id: 'sample-idea-3', title: 'Annual plan as the pricing default', projectKey: 'GROW', stage: 'in_build', createdDayOffset: -20, stageEnteredDayOffset: -10 },
  { id: 'sample-idea-4', title: 'Alert on checkout error-rate spikes', projectKey: 'PLAT', stage: 'shipped', createdDayOffset: -40, stageEnteredDayOffset: -9 },
  { id: 'sample-idea-5', title: 'Multi-currency display prices', projectKey: 'SHOP', stage: 'measured', createdDayOffset: -90, stageEnteredDayOffset: -30 },
  { id: 'sample-idea-6', title: 'Gift wrapping at checkout', projectKey: null, stage: 'idea', createdDayOffset: -15, stageEnteredDayOffset: -15 },
  { id: 'sample-idea-7', title: 'Loyalty points programme', projectKey: null, stage: 'killed', createdDayOffset: -50, stageEnteredDayOffset: -41 },
  { id: 'sample-idea-8', title: 'Live chat on the product page', projectKey: null, stage: 'killed', createdDayOffset: -70, stageEnteredDayOffset: -58 },
];
