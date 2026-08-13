/**
 * The QA vocabulary — ONE grammar for a test step, a finding and a generated spec,
 * shared by the Creation Canvas (browser), the Agentic QA services (API) and the
 * VS Code canvas.
 *
 * ── WHY THIS MOVED HERE ──────────────────────────────────────────────────────────
 * `api/src/application/qa/qaTypes.ts` already owned this grammar, and the canvas had
 * no way to reach it: the browser cannot import from the API. The alternative was a
 * second, structurally identical `QaStep` on the canvas side — which is precisely the
 * drift `canvasTools.ts` exists to stop one layer up. A board that authors a step the
 * generator cannot lower, or a severity the finding router does not recognise, fails
 * SILENTLY: the object looks right and the pipeline drops it.
 *
 * So the grammar lives in the contract both sides already alias, and `qaTypes.ts`
 * re-exports it. One edit changes what a step IS, everywhere.
 *
 * ── WHY THE SPEC GENERATOR IS HERE TOO ───────────────────────────────────────────
 * "Create automation tests for my website" has to end in a file someone can run. The
 * API had a deterministic generator as the LLM's fallback; the canvas needed the same
 * thing as its PRIMARY path, because a guest board has no tenant, no key and no
 * gateway — and an answer that says "sign in and we'll write your tests" is not an
 * answer. `playwrightSpec` is that generator, and it is the same one on both sides, so
 * the spec a board shows and the spec the QA library stores cannot disagree.
 *
 * Everything here is pure and dependency-free: no fetch, no crypto, no Date.now at
 * module scope, so it runs unchanged in a Worker, a browser and a test.
 */

// ───────────────────────────────────────────────────────────────────────────
// Steps
// ───────────────────────────────────────────────────────────────────────────

/** The whole step grammar. A generator that meets these six can lower any plan the
 *  canvas, the crawler or the heatmap planner produces. */
export const QA_STEP_ACTIONS = ['goto', 'click', 'fill', 'expect', 'press', 'waitFor'] as const;

export type QaStepAction = typeof QA_STEP_ACTIONS[number];

/** A single normalized step in a flow. */
export interface QaStep {
  /** goto: navigate to `route`. click: click `selector`. fill: type into
   *  `selector`. expect: assert `assertion` (or that `selector` is visible).
   *  press: keyboard `value`. waitFor: wait for `selector`. */
  action: QaStepAction;
  /** Stable selector — see {@link parseQaSelector} for the accepted forms. */
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

export function isQaStepAction(value: unknown): value is QaStepAction {
  return typeof value === 'string' && (QA_STEP_ACTIONS as readonly string[]).includes(value);
}

/** Longest plan we will lower. A spec that drives a browser is small; anything past
 *  this is a model that lost the plot, and `validateSpec` would reject the output. */
export const MAX_QA_STEPS = 80;

/**
 * Coerce anything — a model's tool arguments, a stored JSON column, a recorded
 * click path — into steps that are safe to lower.
 *
 * A step with an unknown action, or one missing the field its action NEEDS, is
 * dropped rather than defaulted: a `goto` with no route lowers to `page.goto('')`,
 * which fails at run time with an error about the empty string rather than about the
 * plan that was wrong.
 */
export function normalizeQaSteps(value: unknown, limit = MAX_QA_STEPS): QaStep[] {
  if (!Array.isArray(value)) return [];
  const steps: QaStep[] = [];
  for (const raw of value) {
    if (steps.length >= limit) break;
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (!isQaStepAction(item.action)) continue;
    const text = (key: string): string | undefined => {
      const candidate = item[key];
      return typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, 400) : undefined;
    };
    const step: QaStep = { action: item.action };
    const selector = text('selector');
    const route = text('route');
    const value_ = text('value');
    const assertion = text('assertion');
    const label = text('label');
    if (selector) step.selector = selector;
    if (route) step.route = route.startsWith('/') || /^https?:\/\//i.test(route) ? route : `/${route}`;
    if (value_) step.value = value_;
    if (assertion) step.assertion = assertion;
    if (label) step.label = label;
    if (typeof item.heat === 'number' && Number.isFinite(item.heat)) step.heat = item.heat;

    // The field each action cannot work without.
    if (step.action === 'goto' && !step.route) continue;
    if ((step.action === 'click' || step.action === 'fill' || step.action === 'waitFor') && !step.selector) continue;
    if (step.action === 'press' && !step.value) continue;
    if (step.action === 'expect' && !step.selector && !step.assertion && !step.route) continue;
    steps.push(step);
  }
  return steps;
}

// ───────────────────────────────────────────────────────────────────────────
// Findings
// ───────────────────────────────────────────────────────────────────────────

/** Finding types the harness captures while exploring, and the canvas records. */
export const QA_FINDING_TYPES = ['console', 'pageerror', 'network', 'assertion', 'crash', 'navigation'] as const;
export type QaFindingType = typeof QA_FINDING_TYPES[number];

/** Ordered weakest → strongest, so `severityRank` is the index. */
export const QA_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type QaFindingSeverity = typeof QA_SEVERITIES[number];

export function isQaFindingType(value: unknown): value is QaFindingType {
  return typeof value === 'string' && (QA_FINDING_TYPES as readonly string[]).includes(value);
}

export function isQaSeverity(value: unknown): value is QaFindingSeverity {
  return typeof value === 'string' && (QA_SEVERITIES as readonly string[]).includes(value);
}

/** Where a severity sits on the scale. Used to sort a defect list and to compare a
 *  finding against a routing threshold, so neither has to restate the order. */
export function severityRank(severity: QaFindingSeverity): number {
  return QA_SEVERITIES.indexOf(severity);
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

// ───────────────────────────────────────────────────────────────────────────
// Identity
// ───────────────────────────────────────────────────────────────────────────

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
 * Deterministic dedupe fingerprint for a finding.
 *
 * The same identity on the server (one exploration's findings) and on the board (a
 * defect a tester files twice from two runs of the same case), so "we already know
 * about this" is one answer rather than two implementations that disagree.
 */
export function findingFingerprint(f: { type: string; route?: string | null; selector?: string | null; message: string }): string {
  return shortHash(`${f.type}|${f.route ?? ''}|${f.selector ?? ''}|${f.message.slice(0, 200)}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Lowering a plan to Playwright
// ───────────────────────────────────────────────────────────────────────────

/**
 * The selector forms a step may carry, in the order the QA prompt asks a model to
 * prefer them. A recorded selector is written in one of these, so the generator can
 * emit `getByTestId` / `getByRole` rather than a CSS chain that the next release of
 * the page breaks.
 *
 *   testid=create-session      → page.getByTestId('create-session')
 *   role=button[name=Save]     → page.getByRole('button', { name: 'Save' })
 *   text=Send to Brain         → page.getByText('Send to Brain')
 *   label=Email                → page.getByLabel('Email')
 *   anything else              → page.locator('<css>')
 */
export interface QaSelector {
  strategy: 'testId' | 'role' | 'text' | 'label' | 'css';
  value: string;
  /** Accessible name, for the `role=` form only. */
  name?: string;
}

const SELECTOR_PREFIX = /^(testid|test-id|data-testid|role|text|label)\s*=\s*(.+)$/i;
const ROLE_WITH_NAME = /^([a-z]+)\s*\[\s*name\s*=\s*["']?([^\]"']+)["']?\s*\]$/i;

export function parseQaSelector(selector: string): QaSelector {
  const trimmed = selector.trim();
  const prefixed = SELECTOR_PREFIX.exec(trimmed);
  if (!prefixed) return { strategy: 'css', value: trimmed };
  const kind = prefixed[1]!.toLowerCase();
  const rest = prefixed[2]!.trim().replace(/^["']|["']$/g, '');
  if (kind === 'role') {
    const withName = ROLE_WITH_NAME.exec(rest);
    return withName
      ? { strategy: 'role', value: withName[1]!.toLowerCase(), name: withName[2]!.trim() }
      : { strategy: 'role', value: rest.toLowerCase() };
  }
  if (kind === 'text') return { strategy: 'text', value: rest };
  if (kind === 'label') return { strategy: 'label', value: rest };
  return { strategy: 'testId', value: rest };
}

/** A single-quoted JS string literal. `JSON.stringify` would emit double quotes,
 *  which the surrounding spec style does not use and which read worse in a diff. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')}'`;
}

/** The Playwright locator expression for a step's selector. */
export function qaLocatorExpression(selector: string): string {
  const parsed = parseQaSelector(selector);
  switch (parsed.strategy) {
    case 'testId': return `page.getByTestId(${quote(parsed.value)})`;
    case 'role': return parsed.name
      ? `page.getByRole(${quote(parsed.value)}, { name: ${quote(parsed.name)} })`
      : `page.getByRole(${quote(parsed.value)})`;
    case 'text': return `page.getByText(${quote(parsed.value)})`;
    case 'label': return `page.getByLabel(${quote(parsed.value)})`;
    case 'css': return `page.locator(${quote(parsed.value)})`;
  }
}

export interface QaSpecInput {
  name: string;
  slug?: string;
  description?: string | null;
  startRoute?: string | null;
  steps: readonly QaStep[];
}

/**
 * Lower a plan into a runnable Playwright spec.
 *
 * Two invariants this must never break, because both are load-bearing elsewhere:
 *  1. The output passes `validateSpec` (API) — only `@playwright/test` is imported
 *     and no escape hatch appears — so a generated spec is safe to execute in CI.
 *  2. Every navigation is followed by the health assertions the QA system prompt
 *     asks for (not redirected to /login, no error boundary), because a smoke test
 *     that navigates and asserts nothing is a test that cannot fail.
 */
export function playwrightSpec(input: QaSpecInput): string {
  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  if (input.slug) lines.push(`// Generated Playwright spec — ${input.slug}`);
  if (input.description) lines.push(`// ${input.description.replace(/\r?\n/g, ' ').slice(0, 200)}`);
  lines.push(`test(${quote(input.name)}, async ({ page }) => {`);

  const health = () => {
    lines.push(`  await expect(page).not.toHaveURL(/\\/login/);`);
    lines.push(`  await expect(page.getByText(/something went wrong|application error/i)).toHaveCount(0);`);
  };

  let navigated = false;
  for (const step of input.steps.slice(0, MAX_QA_STEPS)) {
    switch (step.action) {
      case 'goto':
        if (!step.route) break;
        lines.push(`  await page.goto(${quote(step.route)});`);
        health();
        navigated = true;
        break;
      case 'click':
        if (!step.selector) break;
        lines.push(`  await ${qaLocatorExpression(step.selector)}.first().click();`);
        break;
      case 'fill':
        if (!step.selector) break;
        lines.push(`  await ${qaLocatorExpression(step.selector)}.first().fill(${quote(step.value ?? 'qa-probe')});`);
        break;
      case 'press':
        if (!step.value) break;
        lines.push(`  await page.keyboard.press(${quote(step.value)});`);
        break;
      case 'waitFor':
        if (!step.selector) break;
        lines.push(`  await ${qaLocatorExpression(step.selector)}.first().waitFor({ state: 'visible' });`);
        break;
      case 'expect':
        if (step.selector) {
          if (step.assertion) lines.push(`  // ${step.assertion.replace(/\r?\n/g, ' ').slice(0, 160)}`);
          lines.push(`  await expect(${qaLocatorExpression(step.selector)}.first()).toBeVisible();`);
        } else if (step.route) {
          lines.push(`  await expect(page).toHaveURL(new RegExp(${quote(escapeForRegExp(step.route))}));`);
        } else if (step.assertion) {
          // No element named, so the only honest assertion is that the page is
          // healthy — recorded with the human sentence so a reader can tighten it.
          lines.push(`  // ${step.assertion.replace(/\r?\n/g, ' ').slice(0, 160)}`);
          lines.push(`  await expect(page.locator('body')).toBeVisible();`);
        }
        break;
    }
  }

  if (!navigated) {
    lines.push(`  await page.goto(${quote(input.startRoute ?? '/')});`);
    health();
    lines.push(`  await expect(page.locator('body')).toBeVisible();`);
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/** Escape a literal for embedding in a `new RegExp(...)` source string. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ───────────────────────────────────────────────────────────────────────────
// Route discovery
// ───────────────────────────────────────────────────────────────────────────

/** Routes that are never worth a generated smoke test: assets, API endpoints and
 *  the auth surface the harness is explicitly told not to script. */
const UNTESTABLE_ROUTE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|woff2?|ttf|pdf|zip|xml|txt)$/i;
const EXCLUDED_ROUTE_PREFIX = /^\/(api|_next|cdn-cgi|static|assets)(\/|$)/i;
const AUTH_ROUTE = /^\/(login|signin|sign-in|logout|signout|register|signup|sign-up)(\/|$)/i;

/**
 * Pull testable route paths out of a fetched page's HTML.
 *
 * Deliberately regex over `href=`, not a DOM parse: this runs in a Worker, in a
 * browser and in a test, and the input is whatever `builtin_web_fetch` returned —
 * frequently partial HTML. Anything that is not a same-site page path is dropped.
 */
export function routesFromHtml(html: string, baseUrl?: string): string[] {
  let origin: string | null = null;
  try {
    origin = baseUrl ? new URL(baseUrl).origin : null;
  } catch {
    origin = null;
  }
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const raw = match[1]!.trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;
    let path: string | null = null;
    if (raw.startsWith('/')) path = raw;
    else if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        if (origin && url.origin !== origin) continue;
        if (!origin) continue;
        path = url.pathname + url.search;
      } catch { continue; }
    }
    if (!path) continue;
    path = path.replace(/\/+$/, '') || '/';
    if (UNTESTABLE_ROUTE.test(path) || EXCLUDED_ROUTE_PREFIX.test(path) || AUTH_ROUTE.test(path)) continue;
    if (path.length > 120) continue;
    found.add(path);
  }
  return [...found].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/**
 * The deterministic smoke plan for one route: go there, prove it arrived, prove it
 * is not an error page. Every generated case starts from this and is then widened
 * by whatever the author or the model adds.
 */
export function smokeStepsForRoute(route: string): QaStep[] {
  return [
    { action: 'goto', route },
    { action: 'expect', route, assertion: `route ${route} renders without an error boundary` },
  ];
}
