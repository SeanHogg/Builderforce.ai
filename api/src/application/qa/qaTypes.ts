/**
 * Agentic QA — shared types across capture, flow aggregation, generation, and
 * run reporting. Kept dependency-free so both the route layer and the services
 * import from one place.
 *
 * ── WHERE THE GRAMMAR LIVES ──────────────────────────────────────────────────
 * The STEP grammar, the finding vocabulary, the slug/hash identity helpers and the
 * deterministic Playwright generator now live in
 * `packages/creation-canvas-contract/src/qa.ts` and are re-exported here.
 *
 * They moved because the Creation Canvas needs the same grammar and cannot import
 * from this package: a board authors steps, lowers them to a spec, and files a
 * finding, and a second structurally-identical `QaStep` on that side would drift
 * exactly the way the canvas tool lists drifted from the gateway's. This file keeps
 * what is genuinely storage-shaped — flows, runs, heat zones, credentials — and
 * re-exports the shared half so no existing importer changes.
 */

export {
  QA_STEP_ACTIONS, MAX_QA_STEPS, isQaStepAction, normalizeQaSteps,
  QA_FINDING_TYPES, QA_SEVERITIES, isQaFindingType, isQaSeverity, severityRank, defaultFindingSeverity,
  toSlug, shortHash, findingFingerprint,
  playwrightSpec, qaLocatorExpression, parseQaSelector, routesFromHtml, smokeStepsForRoute,
} from '@builderforce/creation-canvas-contract';
export type {
  QaStep, QaStepAction, QaFindingType, QaFindingSeverity, QaSelector, QaSpecInput,
} from '@builderforce/creation-canvas-contract';

import type { QaStep, QaFindingType, QaFindingSeverity } from '@builderforce/creation-canvas-contract';

/** A flow as stored in qa_flows (steps serialized to JSON in the column). */
export interface QaFlow {
  id: string;
  name: string;
  slug: string;
  source: 'usage' | 'crawl' | 'manual';
  description: string | null;
  startRoute: string | null;
  steps: QaStep[];
  frequency: number;
  status: string;
}

/** Result a CI harness posts back for one executed test. */
export interface QaRunReport {
  testId?: string | null;
  testSlug?: string | null;
  projectId?: number | null;
  credentialId?: string | null;
  targetId?: string | null;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  browser?: string;
  targetUrl?: string;
  commitSha?: string;
  runKey?: string;
  durationMs?: number;
  errorMessage?: string;
  logs?: string;
  screenshotKeys?: string[];
  steps?: Array<{
    seq: number;
    action: string;
    selector?: string;
    status: 'passed' | 'failed' | 'skipped';
    durationMs?: number;
    errorMessage?: string;
    screenshotKey?: string;
  }>;
}

/**
 * Heuristically infer the persona role a flow needs from the routes it visits.
 * Admin/settings surfaces imply an elevated persona; everything else is a plain
 * member. Returns null when nothing in the path suggests a specific role (the
 * generate step then falls back to the project's default credential). The
 * generator can refine this, but the heuristic gives a sensible default so a
 * captured /admin journey isn't run as a viewer that 403s.
 */
export function inferPersonaRole(routes: readonly string[]): string | null {
  const joined = routes.join(' ').toLowerCase();
  if (/\/admin(\/|$|\s)/.test(joined)) return 'admin';
  if (/\/(settings|security|approvals|members|api-keys)(\/|$|\s)/.test(joined)) return 'manager';
  if (routes.length > 0) return 'member';
  return null;
}

/** A credential as exposed to clients — the password is NEVER included. */
export interface QaCredentialPublic {
  id: string;
  projectId: number;
  label: string;
  role: string | null;
  username: string;
  loginUrl: string | null;
  status: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Agentic Tester (migration 0206) — heatmap-driven exploratory testing.
// ───────────────────────────────────────────────────────────────────────────

/** A "hot zone": a route or interaction target ranked by how often real users
 *  touched it (interaction heat from qa_journey_events). The agentic tester
 *  prioritises exercising these — the busier a control, the more a regression
 *  there hurts. `heat` is the raw interaction count; `score` folds in recency. */
export interface QaHeatZone {
  route: string;
  /** Stable selector for an element-level zone; null for a route-level zone. */
  selector: string | null;
  /** 'click' | 'input' | 'submit' | 'nav' | 'pageview' — the dominant interaction. */
  kind: string;
  label: string | null;
  /** Raw number of captured interactions on this zone in the window. */
  heat: number;
  /** Recency-weighted rank score (heat decayed by age of last interaction). */
  score: number;
}

/** One captured runtime error the harness posts back for an exploration. */
export interface QaFindingReport {
  type: QaFindingType;
  severity?: QaFindingSeverity;
  route?: string | null;
  selector?: string | null;
  message: string;
  detail?: string | null;
  /** Heat of the zone this surfaced in (carried from the plan step). */
  heat?: number;
  screenshotKey?: string | null;
}

/** Rolled-up outcome the harness PATCHes when an exploration finishes. */
export interface QaExplorationOutcome {
  status: 'running' | 'passed' | 'failed' | 'error';
  zonesExplored?: number;
  browser?: string;
  targetUrl?: string;
  commitSha?: string;
  runKey?: string;
  summary?: string;
  errorMessage?: string;
}

/**
 * Turn ranked heat zones into an ordered exploration plan (QaStep[]) the harness
 * executes. Deterministic: visit each hot route, then exercise each hot element
 * (click / fill a synthetic value), asserting the page stays healthy after each.
 * The LLM planner (when a key is configured) only re-orders / prunes this — the
 * deterministic core guarantees a runnable plan with no model dependency.
 */
export function buildExplorationPlan(zones: readonly QaHeatZone[], budget: number): QaStep[] {
  const steps: QaStep[] = [];
  const visitedRoutes = new Set<string>();
  let exercised = 0;
  for (const z of zones) {
    if (exercised >= budget) break;
    if (z.route && !visitedRoutes.has(z.route)) {
      steps.push({ action: 'goto', route: z.route, heat: z.heat });
      steps.push({ action: 'expect', route: z.route, assertion: `route ${z.route} renders without an error boundary`, heat: z.heat });
      visitedRoutes.add(z.route);
    }
    if (z.selector) {
      if (z.kind === 'input') {
        steps.push({ action: 'fill', selector: z.selector, value: 'qa-probe', label: z.label ?? undefined, heat: z.heat });
      } else {
        steps.push({ action: 'click', selector: z.selector, label: z.label ?? undefined, heat: z.heat });
      }
      steps.push({ action: 'expect', selector: z.selector, assertion: `interacting with ${z.label ?? z.selector} does not break the page`, label: z.label ?? undefined, heat: z.heat });
      exercised++;
    } else if (z.route) {
      exercised++;
    }
  }
  return steps;
}
