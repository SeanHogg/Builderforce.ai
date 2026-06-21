/**
 * Agentic QA — shared types across capture, flow aggregation, generation, and
 * run reporting. Kept dependency-free so both the route layer and the services
 * import from one place.
 */

/** A single normalized step in a flow. The generator turns these into Playwright
 *  calls; the capture client and the aggregator emit them. */
export interface QaStep {
  /** goto: navigate to `route`. click: click `selector`. fill: type into
   *  `selector`. expect: assert `assertion` (or that `selector` is visible).
   *  press: keyboard `value`. waitFor: wait for `selector`. */
  action: 'goto' | 'click' | 'fill' | 'expect' | 'press' | 'waitFor';
  /** Stable selector — Playwright getByTestId / getByRole / css. */
  selector?: string;
  /** Route pathname (goto). */
  route?: string;
  /** Synthetic, safe value for fills (never real captured input) or key for press. */
  value?: string;
  /** Human-readable assertion for expect steps, e.g. "dashboard heading visible". */
  assertion?: string;
  /** Accessible label / trimmed text, for prompt readability + run-step labelling. */
  label?: string;
  /** Interaction heat of the zone this step targets (Agentic Tester plans only) —
   *  carried through so a finding surfaced here inherits the zone's importance. */
  heat?: number;
}

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

/** Stable slug from an arbitrary string (lowercase kebab, ascii-only). */
export function toSlug(input: string, fallback = 'flow'): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || fallback;
}

/** Deterministic short hash (FNV-1a, base36) — used to make flow slugs stable
 *  across re-aggregation without a crypto dependency or random ids. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
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

/** Finding types the harness captures while exploring. */
export type QaFindingType = 'console' | 'pageerror' | 'network' | 'assertion' | 'crash' | 'navigation';
export type QaFindingSeverity = 'low' | 'medium' | 'high' | 'critical';

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

/** Map a finding type + zone heat into a default severity. Network/page errors on
 *  a hot zone are worse than a console warning on a cold one. The harness may
 *  override, but this gives a sensible server-side default + keeps the UI honest. */
export function defaultFindingSeverity(type: QaFindingType, heat: number): QaFindingSeverity {
  if (type === 'crash') return 'critical';
  if (type === 'pageerror' || type === 'navigation') return heat >= 20 ? 'critical' : 'high';
  if (type === 'network') return heat >= 20 ? 'high' : 'medium';
  if (type === 'assertion') return heat >= 20 ? 'high' : 'medium';
  return heat >= 50 ? 'medium' : 'low'; // console
}

/** Deterministic dedupe fingerprint for a finding within one exploration. */
export function findingFingerprint(f: { type: string; route?: string | null; selector?: string | null; message: string }): string {
  return shortHash(`${f.type}|${f.route ?? ''}|${f.selector ?? ''}|${f.message.slice(0, 200)}`);
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
