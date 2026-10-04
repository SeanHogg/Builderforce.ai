/**
 * `canvas_inspect_preview` — the Studio agent's eyes on the app it is changing.
 *
 * Probes the RUNNING preview at real device widths (see `probeScript.ts` for why
 * measurements, `runPreviewProbe.ts` for how) and returns one verdict per width from
 * the shared {@link assessProbe}. Its `passed` flag is what the run loop's review
 * contract (`previewReview.ts` in brain-embedded) reads before it will close a ticket,
 * so it is computed in exactly one place.
 *
 * Its own module rather than another entry in `canvasBuildTools.ts`: the file tools are
 * pure functions over a file store, testable without a browser; this one needs the DOM
 * and a live preview, and only the Studio has one.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import {
  CANVAS_INSPECT_PREVIEW_TOOL,
  CANVAS_VIEWPORTS,
  CANVAS_VIEWPORT_CAPTURE_HEIGHTS,
  CANVAS_VIEWPORT_WIDTHS,
  type CanvasViewport,
} from '@builderforce/creation-canvas-contract';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { assessProbe, type ProbeReport } from './probeReport';
import { runPreviewProbe } from './runPreviewProbe';

/** Narrowest and widest custom width worth probing. */
const MIN_WIDTH = 280;
const MAX_WIDTH = 2560;
const MAX_VIEWPORTS = 5;
/** Matches per selector echoed back. The probe measures more; the result budget is ~6 KB. */
const MATCHES_SHOWN = 3;

/** Computed values that say nothing a reviewer needs — dropped to keep the result small. */
const DEFAULT_STYLE_VALUES = new Set(['none', 'auto', 'normal', 'visible', 'static', '0 1 auto', 'rgba(0, 0, 0, 0)']);

export interface ProbeViewport { name: string; width: number; height: number }

/** Height for a custom width: that of the nearest named device class. */
function heightFor(width: number): number {
  const nearest = [...CANVAS_VIEWPORTS].sort(
    (a, b) => Math.abs(CANVAS_VIEWPORT_WIDTHS[a] - width) - Math.abs(CANVAS_VIEWPORT_WIDTHS[b] - width),
  )[0];
  return CANVAS_VIEWPORT_CAPTURE_HEIGHTS[nearest];
}

/**
 * The viewports a call asks for: named device classes from the shared canvas vocabulary
 * (so "mobile" here is the width the board draws and the capture service shoots), plus
 * any exact widths. Defaults to all three device classes.
 */
export function probeViewportsFrom(viewports: unknown, widths: unknown): ProbeViewport[] {
  const out: ProbeViewport[] = [];
  const named = Array.isArray(viewports)
    ? viewports.filter((value): value is CanvasViewport => (CANVAS_VIEWPORTS as readonly unknown[]).includes(value))
    : [];
  for (const name of named) out.push({ name, width: CANVAS_VIEWPORT_WIDTHS[name], height: CANVAS_VIEWPORT_CAPTURE_HEIGHTS[name] });
  for (const raw of Array.isArray(widths) ? widths : []) {
    const width = Math.round(Number(raw));
    if (!Number.isFinite(width) || width < MIN_WIDTH || width > MAX_WIDTH) continue;
    if (out.some((viewport) => viewport.width === width)) continue;
    out.push({ name: `${width}px`, width, height: heightFor(width) });
  }
  if (!out.length) {
    for (const name of ['mobile', 'tablet', 'desktop'] as const) {
      out.push({ name, width: CANVAS_VIEWPORT_WIDTHS[name], height: CANVAS_VIEWPORT_CAPTURE_HEIGHTS[name] });
    }
  }
  return out.slice(0, MAX_VIEWPORTS);
}

function compactStyle(style: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value && !DEFAULT_STYLE_VALUES.has(value)));
}

/** One viewport's result as the model reads it: verdict first, evidence after. */
export function viewportResult(viewport: ProbeViewport, report: ProbeReport) {
  const verdict = assessProbe(report);
  return {
    viewport: viewport.name,
    width: report.viewport.width || viewport.width,
    passed: verdict.passed,
    ...(verdict.failures.length ? { failures: verdict.failures } : {}),
    ...(verdict.warnings.length ? { warnings: verdict.warnings } : {}),
    documentWidth: report.documentWidth,
    ...(report.selectors.length ? {
      elements: report.selectors.map((result) => ({
        selector: result.selector,
        count: result.count,
        ...(result.error ? { error: result.error } : {}),
        matches: result.matches.slice(0, MATCHES_SHOWN).map((match) => ({
          element: match.element,
          ...(match.text ? { text: match.text.slice(0, 40) } : {}),
          visible: match.visible,
          rect: match.rect,
          ...(match.occludedBy ? { occludedBy: match.occludedBy } : {}),
          style: compactStyle(match.style),
        })),
      })),
    } : {}),
    ...(report.smallTargets.length ? { smallTargets: report.smallTargets.slice(0, 4) } : {}),
  };
}

export function inspectPreviewAction(ctx: {
  /** The running preview's URL, read at call time; undefined while it is not running. */
  previewUrl: () => string | undefined;
}): BrainAction {
  return {
    name: CANVAS_INSPECT_PREVIEW_TOOL,
    description: 'Look at the RUNNING app the way a reviewer with devtools would: loads the live preview at real device widths (mobile 390px, tablet 834px, desktop 1280px by default, or exact widths) and measures what is actually on screen. Reports, per width, a passed/failed verdict with the defects found — the page scrolling sideways, elements pushed past the screen edge, broken images, runtime errors — and, for every CSS selector you name, each match\'s size and position, key computed styles, and whether something else covers it. Use it to VERIFY a visual or layout change before you call it done: name the selectors your change targets (e.g. ".character-tag", ".nav-toggle", ".hero h1") and read the numbers. It never changes anything and the user does not see it run.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        selectors: {
          type: 'array', items: { type: 'string' }, maxItems: 10,
          description: 'CSS selectors for the elements the change is about. Each is measured at every width.',
        },
        viewports: {
          type: 'array', items: { type: 'string', enum: [...CANVAS_VIEWPORTS] },
          description: 'Device classes to check. Defaults to all three.',
        },
        widths: {
          type: 'array', items: { type: 'number' },
          description: `Exact widths in CSS px (${MIN_WIDTH}–${MAX_WIDTH}), e.g. [360, 414] for a mobile bug report.`,
        },
        path: { type: 'string', description: 'In-app route or #anchor to load, e.g. "/pricing". Defaults to the home page.' },
      },
    },
    run: async (raw: unknown) => {
      const args = (raw ?? {}) as { selectors?: unknown; viewports?: unknown; widths?: unknown; path?: unknown };
      const previewUrl = ctx.previewUrl();
      if (!previewUrl) {
        return { error: 'The preview is not running, so there is nothing to inspect yet. It starts by itself when the workspace opens — if it stopped, ask the user to press Run, or call canvas_read_build_diagnostics to see why it failed.' };
      }
      const selectors = Array.isArray(args.selectors)
        ? args.selectors.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()).slice(0, 10)
        : [];
      const path = typeof args.path === 'string' ? args.path : undefined;
      const viewports = probeViewportsFrom(args.viewports, args.widths);

      const results = [];
      // One frame at a time: several copies of the app booting at once compete for the
      // same in-browser runtime and make every measurement slower and noisier.
      for (const viewport of viewports) {
        try {
          const report = await runPreviewProbe({ previewUrl, path, width: viewport.width, height: viewport.height, selectors });
          results.push(viewportResult(viewport, report));
        } catch (error) {
          return { error: toolErrorMessage(error, 'The preview could not be inspected.') };
        }
      }
      const passed = results.every((result) => result.passed);
      return {
        ok: true,
        passed,
        ...(path ? { path } : {}),
        checkedAt: new Date().toISOString(),
        viewports: results,
        next: passed
          ? 'Every width passed. Check the measurements against what the ticket asked for — a pass means nothing is broken, not that the change is right — then record your review.'
          : 'Fix the failures listed above, then inspect again. Do not record the review or close the ticket while a width fails.',
      };
    },
  };
}
