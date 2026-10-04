/**
 * What the review probe reports, and the ONE judgement of whether a viewport passes.
 *
 * Pure (no DOM, no React) so the verdict is unit-testable and so the host never
 * trusts the shape of a message from a frame: every field is re-read defensively.
 * The judgement lives here, not in the tool, because the run loop's close-the-ticket
 * backstop reads the tool's `passed` flag — "passed" must mean one thing.
 */

import { PREVIEW_PROBE_RESULT } from './probeScript';

export interface ProbeRect { x: number; y: number; width: number; height: number }

export interface ProbeMatch {
  element: string;
  text: string;
  visible: boolean;
  rect: ProbeRect;
  inViewport: boolean;
  style: Record<string, string>;
  occludedBy: string | null;
}

export interface ProbeSelectorResult {
  selector: string;
  count: number;
  matches: ProbeMatch[];
  error?: string;
}

export interface ProbeReport {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  documentWidth: number;
  documentHeight: number;
  pageOverflowXHidden: boolean;
  overflowing: Array<{ element: string; left: number; right: number; width: number; position: string }>;
  overflowingCount: number;
  smallTargets: Array<{ element: string; text: string; width: number; height: number }>;
  smallTargetCount: number;
  clippedText: Array<{ element: string; text: string; visibleWidth: number; contentWidth: number }>;
  clippedTextCount: number;
  brokenImages: Array<{ element: string; src: string }>;
  imagesWithoutAlt: Array<{ element: string; src: string }>;
  imagesWithoutAltCount: number;
  errors: string[];
  selectors: ProbeSelectorResult[];
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const arr = <T>(value: unknown, read: (item: Record<string, unknown>) => T): T[] =>
  (Array.isArray(value) ? value : [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(read);

function readRect(value: unknown): ProbeRect {
  const rect = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) };
}

function readStyle(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

/**
 * Parse a `message` event from a probed frame. Null when the message is not a probe
 * result for `id` — the host's other frames (the visible preview) share the channel.
 * A probe that threw inside the page answers `{ error }`.
 */
export function probeResultFrom(data: unknown, id: string): ProbeReport | { error: string } | null {
  if (!data || typeof data !== 'object') return null;
  const envelope = data as { type?: unknown; id?: unknown; report?: unknown };
  if (envelope.type !== PREVIEW_PROBE_RESULT || envelope.id !== id) return null;
  const raw = (envelope.report && typeof envelope.report === 'object' ? envelope.report : {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };
  const viewport = (raw.viewport && typeof raw.viewport === 'object' ? raw.viewport : {}) as Record<string, unknown>;
  return {
    url: str(raw.url),
    title: str(raw.title),
    viewport: { width: num(viewport.width), height: num(viewport.height) },
    documentWidth: num(raw.documentWidth),
    documentHeight: num(raw.documentHeight),
    pageOverflowXHidden: raw.pageOverflowXHidden === true,
    overflowing: arr(raw.overflowing, (item) => ({ element: str(item.element), left: num(item.left), right: num(item.right), width: num(item.width), position: str(item.position) })),
    overflowingCount: num(raw.overflowingCount),
    smallTargets: arr(raw.smallTargets, (item) => ({ element: str(item.element), text: str(item.text), width: num(item.width), height: num(item.height) })),
    smallTargetCount: num(raw.smallTargetCount),
    clippedText: arr(raw.clippedText, (item) => ({ element: str(item.element), text: str(item.text), visibleWidth: num(item.visibleWidth), contentWidth: num(item.contentWidth) })),
    clippedTextCount: num(raw.clippedTextCount),
    brokenImages: arr(raw.brokenImages, (item) => ({ element: str(item.element), src: str(item.src) })),
    imagesWithoutAlt: arr(raw.imagesWithoutAlt, (item) => ({ element: str(item.element), src: str(item.src) })),
    imagesWithoutAltCount: num(raw.imagesWithoutAltCount),
    errors: (Array.isArray(raw.errors) ? raw.errors : []).filter((e): e is string => typeof e === 'string'),
    selectors: arr(raw.selectors, (item) => ({
      selector: str(item.selector),
      count: num(item.count),
      ...(typeof item.error === 'string' ? { error: item.error } : {}),
      matches: arr(item.matches, (match) => ({
        element: str(match.element),
        text: str(match.text),
        visible: match.visible === true,
        rect: readRect(match.rect),
        inViewport: match.inViewport === true,
        style: readStyle(match.style),
        occludedBy: typeof match.occludedBy === 'string' ? match.occludedBy : null,
      })),
    })),
  };
}

export interface ProbeAssessment {
  /** True when nothing at this width is a defect a reviewer would send back. */
  passed: boolean;
  /** Defects: each one alone fails the viewport. */
  failures: string[];
  /** Worth a look, not a failure on their own (small targets, missing alt, a fixed drawer parked off-screen). */
  warnings: string[];
}

/**
 * The ONE verdict for a probed viewport.
 *
 * Fails on what is unambiguously broken: the page scrolls sideways, content is pushed
 * past the edge and nothing clips it, an image does not load, the app threw, a selector
 * the reviewer named matches nothing or is hidden/covered. `overflow-x: hidden` on the
 * page is NOT a pass by itself — content cut off at the edge is still cut off, which is
 * why an element past the edge fails even when the page cannot scroll.
 *
 * Fixed/absolute elements wholly off-screen (a closed slide-in drawer) are warnings:
 * that is a common, correct pattern, and the reviewer can see the position to judge.
 */
export function assessProbe(report: ProbeReport): ProbeAssessment {
  const failures: string[] = [];
  const warnings: string[] = [];
  const width = report.viewport.width;

  if (report.documentWidth > width + 1) {
    failures.push(`page is ${report.documentWidth}px wide in a ${width}px viewport — it scrolls sideways by ${report.documentWidth - width}px`);
  }
  for (const item of report.overflowing) {
    const parked = (item.position === 'fixed' || item.position === 'absolute') && (item.left >= width || item.right <= 0);
    const line = `${item.element} spans ${item.left}–${item.right}px in a ${width}px viewport (${item.position})`;
    if (parked) warnings.push(`${line} — off-screen; fine if it is a closed drawer/menu`);
    else failures.push(`${line}${report.pageOverflowXHidden ? ' — cut off by overflow-x: hidden, not fixed by it' : ''}`);
  }
  for (const image of report.brokenImages) failures.push(`image did not load: ${image.src} (${image.element})`);
  for (const error of report.errors) failures.push(`runtime error: ${error}`);
  for (const result of report.selectors) {
    if (result.error) { failures.push(`selector "${result.selector}": ${result.error}`); continue; }
    if (result.count === 0) { failures.push(`selector "${result.selector}" matches nothing at ${width}px`); continue; }
    for (const match of result.matches) {
      if (!match.visible) warnings.push(`"${result.selector}" → ${match.element} is not visible at ${width}px`);
      else if (match.occludedBy) failures.push(`"${result.selector}" → ${match.element} is covered by ${match.occludedBy} at ${width}px`);
    }
  }
  if (report.clippedTextCount > 0) warnings.push(`${report.clippedTextCount} element(s) cut their text off horizontally`);
  if (report.smallTargetCount > 0) warnings.push(`${report.smallTargetCount} tap target(s) smaller than 44×44px`);
  if (report.imagesWithoutAltCount > 0) warnings.push(`${report.imagesWithoutAltCount} image(s) without alt text`);

  return { passed: failures.length === 0, failures, warnings };
}
