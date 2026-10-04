import { describe, expect, it } from 'vitest';
import { PREVIEW_REVIEW_TOOL } from '@seanhogg/builderforce-brain-embedded';
import { CANVAS_INSPECT_PREVIEW_TOOL, GUEST_SAFE_CANVAS_TOOLS } from '@builderforce/creation-canvas-contract';
import { inspectPreviewAction, probeViewportsFrom, viewportResult } from './inspectPreviewAction';
import type { ProbeReport } from './probeReport';

describe('the tool name', () => {
  /** The run loop's review contract keys on this name; the two spellings must agree. */
  it('is the name the run loop reviews by', () => {
    expect(CANVAS_INSPECT_PREVIEW_TOOL).toBe(PREVIEW_REVIEW_TOOL);
    expect(inspectPreviewAction({ previewUrl: () => undefined }).name).toBe(PREVIEW_REVIEW_TOOL);
  });

  it('is classified guest-safe — it reads only the app the visitor is looking at', () => {
    expect(GUEST_SAFE_CANVAS_TOOLS).toContain(CANVAS_INSPECT_PREVIEW_TOOL);
  });
});

describe('probeViewportsFrom', () => {
  it('defaults to the three shared device classes', () => {
    expect(probeViewportsFrom(undefined, undefined)).toEqual([
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 834, height: 1112 },
      { name: 'desktop', width: 1280, height: 800 },
    ]);
  });

  it('takes exact widths, sized like the nearest device class, without duplicates', () => {
    expect(probeViewportsFrom(['mobile'], [360, 390, 1440, 99, 'x'])).toEqual([
      { name: 'mobile', width: 390, height: 844 },
      { name: '360px', width: 360, height: 844 },
      { name: '1440px', width: 1440, height: 800 },
    ]);
  });

  it('caps the number of viewports', () => {
    expect(probeViewportsFrom(undefined, [300, 320, 340, 360, 380, 400, 420])).toHaveLength(5);
  });
});

describe('viewportResult', () => {
  const report: ProbeReport = {
    url: '/', title: '', viewport: { width: 390, height: 844 },
    documentWidth: 390, documentHeight: 2000, pageOverflowXHidden: false,
    overflowing: [], overflowingCount: 0, smallTargets: [], smallTargetCount: 0,
    clippedText: [], clippedTextCount: 0, brokenImages: [], imagesWithoutAlt: [], imagesWithoutAltCount: 0,
    errors: [],
    selectors: [{
      selector: '.character-tag', count: 4,
      matches: [1, 2, 3, 4].map((n) => ({
        element: `span.character-tag.n${n}`, text: 'HERO', visible: true,
        rect: { x: 10, y: 100 * n, width: 74, height: 23 }, inViewport: true,
        style: { display: 'inline-flex', height: '23px', transform: 'none', zIndex: 'auto', backgroundColor: 'rgba(0, 0, 0, 0)' },
        occludedBy: null,
      })),
    }],
  };

  it('leads with the verdict and keeps the evidence compact', () => {
    const result = viewportResult({ name: 'mobile', width: 390, height: 844 }, report);
    expect(result.passed).toBe(true);
    expect(result).not.toHaveProperty('failures');
    expect(result.elements?.[0].count).toBe(4);
    expect(result.elements?.[0].matches).toHaveLength(3);
    // Default computed values carry no information and cost the result budget.
    expect(result.elements?.[0].matches[0].style).toEqual({ display: 'inline-flex', height: '23px' });
  });
});

describe('inspectPreviewAction', () => {
  it('says plainly when there is no running preview to inspect', async () => {
    const out = await inspectPreviewAction({ previewUrl: () => undefined }).run({}) as { error?: string };
    expect(out.error).toMatch(/preview is not running/);
  });
});
