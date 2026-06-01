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
