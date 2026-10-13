/**
 * Page-review DTOs for tests (PRD 33 §5.2) — every field present, so a test
 * overrides only what it is about.
 */

import type { ReplayPageCaptureDto, ReplayPageReviewDto, ReplayVisualDto, VisualPatch } from '@builderforce/interaction-contract';

export function capture(over: Partial<ReplayPageCaptureDto> = {}): ReplayPageCaptureDto {
  const id = over.id ?? 'cap-desktop';
  return {
    id,
    path: '/pricing',
    releaseKey: 'rel-b',
    deviceClass: 'desktop',
    capturedAt: '2026-10-10T00:00:00.000Z',
    screenshotUrl: `/api/replay/pages/captures/${id}/screenshot?site=site-1`,
    foldScreenshotUrl: `/api/replay/pages/captures/${id}/fold?site=site-1`,
    seo: {
      title: 'Pricing', titleLength: 7, metaDescription: null, metaDescriptionLength: 0, canonical: null, robots: null,
      indexable: true, h1Count: 2, headingLevels: [1, 1, 2], headingOrderOk: true,
      og: { title: false, description: false, image: false }, twitterCard: false, structuredDataTypes: [],
      imageCount: 4, imagesWithAlt: 3, internalLinks: 10, externalLinks: 1, wordCount: 420, hreflang: [],
    },
    content: {
      aboveFoldText: 'Plans', aboveFoldWords: 12, valuePropAboveFold: false, ctaLabels: ['Learn more'], ctaCount: 1,
      ctaAboveFold: 1, readabilityGrade: 9.2, readingTimeSec: 90, formFields: 0, trustSignals: [],
    },
    labPerf: { lcpMs: 3100, cls: 40, tbtMs: 120, pageWeightBytes: 900_000, requestCount: 40, largestImages: [], renderBlocking: [] },
    a11y: { contrastFailures: [], smallTapTargets: [], missingLabels: [], missingAlt: [], focusOrderIssues: 0 },
    score: { total: 64, conversion: 50, frustration: 80, seo: 40, performance: 55, accessibility: 95 },
    ...over,
  };
}

export function visual(patch: VisualPatch, over: Partial<ReplayVisualDto> = {}): ReplayVisualDto {
  return { patch, afterScreenshotUrls: {}, callouts: [], ...over };
}

export function pageReview(over: Partial<ReplayPageReviewDto> = {}): ReplayPageReviewDto {
  return {
    path: '/pricing',
    captures: [capture(), capture({ id: 'cap-phone', deviceClass: 'phone' })],
    prescriptions: [],
    scoreByRelease: [{ releaseKey: 'rel-b', label: null, score: 64 }],
    ...over,
  };
}
