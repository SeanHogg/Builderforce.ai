/** Insights API contract — the page review (PRD 33 §5.2, D14, S4f). Re-exported by `../api.ts`; see its header. */
import type { PageRect, VisualPatch } from '../visualPatch';
import type { ImprovementAudience } from '../improvementPrompt';
import type { ReplayPrescriptionDto } from './prescriptions';

/** The two sizes a key page is captured at (1440×900 and 390×844). */
export type ReplayCaptureDevice = 'desktop' | 'phone';

export const REPLAY_CAPTURE_DEVICES: readonly ReplayCaptureDevice[] = ['desktop', 'phone'];

/** `replay_page_captures.seo` — what the runner read from the page's markup. */
export interface ReplayPageSeoFacts {
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  robots: string | null;
  indexable: boolean;
  h1Count: number;
  /** Heading levels in document order (1..6). */
  headingLevels: number[];
  /** True when no heading skips a level going down. */
  headingOrderOk: boolean;
  og: { title: boolean; description: boolean; image: boolean };
  twitterCard: boolean;
  structuredDataTypes: string[];
  imageCount: number;
  imagesWithAlt: number;
  internalLinks: number;
  externalLinks: number;
  wordCount: number;
  hreflang: string[];
}

/** `replay_page_captures.content` — never text from a masked or blocked region. */
export interface ReplayPageContentFacts {
  /** Visible text above the fold, masked regions excluded, ≤ 600 chars. */
  aboveFoldText: string;
  aboveFoldWords: number;
  valuePropAboveFold: boolean;
  ctaLabels: string[];
  ctaCount: number;
  ctaAboveFold: number;
  readabilityGrade: number | null;
  readingTimeSec: number;
  formFields: number;
  /** Kinds found: `testimonial`, `review`, `rating`, `logos`, `guarantee`, `security`, `stats`. */
  trustSignals: string[];
  /** The page's own colours (normalised, most used first) — the only colours a visual patch may use. */
  palette?: string[];
}

/** `replay_page_captures.lab_perf` — one load in the runner (not field data). */
export interface ReplayPageLabPerf {
  lcpMs: number | null;
  /** CLS × 1000, as `VITAL_BUCKETS.CLS`. */
  cls: number | null;
  tbtMs: number | null;
  pageWeightBytes: number;
  requestCount: number;
  largestImages: Array<{ url: string; bytes: number; selector: string | null; aboveFold: boolean }>;
  renderBlocking: string[];
}

/** `replay_page_captures.a11y`. */
export interface ReplayPageA11yFacts {
  contrastFailures: Array<{ selector: string; ratio: number; required: number }>;
  /** Phone capture only: interactive elements smaller than 44 × 44 px. */
  smallTapTargets: Array<{ selector: string; w: number; h: number }>;
  missingLabels: Array<{ selector: string }>;
  missingAlt: Array<{ selector: string }>;
  /** Positive `tabindex` values (focus order that fights the document order). */
  focusOrderIssues: number;
}

/** `replay_page_captures.score` — 0..100 per component; a null component had no data. */
export interface ReplayPageScoreDto {
  total: number;
  conversion: number | null;
  frustration: number | null;
  seo: number | null;
  performance: number | null;
  accessibility: number | null;
}

export interface ReplayPageCaptureDto {
  id: string;
  path: string;
  releaseKey: string;
  deviceClass: ReplayCaptureDevice;
  capturedAt: string;
  /** `REPLAY_PATHS.capturesAsset` URLs (member-authorised); null when not stored. */
  screenshotUrl: string | null;
  foldScreenshotUrl: string | null;
  seo: ReplayPageSeoFacts | null;
  content: ReplayPageContentFacts | null;
  labPerf: ReplayPageLabPerf | null;
  a11y: ReplayPageA11yFacts | null;
  score: ReplayPageScoreDto | null;
}

/** A Google result as it reads before and after an SEO meta change. */
export interface ReplaySerpSnippet {
  title: string;
  url: string;
  description: string;
}

/** `replay_prescriptions.visual` — the rendered before/after of a page-review fix. */
export interface ReplayVisualDto {
  patch: VisualPatch;
  /** `REPLAY_PATHS.capturesAsset` URLs of the after renders, once the runner produced them. */
  afterScreenshotUrls: { desktop?: string; phone?: string };
  serp?: { before: ReplaySerpSnippet; after: ReplaySerpSnippet };
  jsonLdDiff?: string;
  /** The numbered callouts on the "before" capture: each element the patch touches. */
  callouts: Array<{ n: number; selector: string }>;
}

/** `GET REPLAY_PATHS.pageReview?site&path`. */
export interface ReplayPageReviewDto {
  path: string;
  /** Newest release first; both devices of each. */
  captures: ReplayPageCaptureDto[];
  /** `source` rule | observed; page-review fixes carry `visual`. */
  prescriptions: ReplayPrescriptionDto[];
  scoreByRelease: Array<{ releaseKey: string; label: string | null; score: number | null }>;
}

/** One row of `GET REPLAY_PATHS.pages?site`. */
export interface ReplayPageListItemDto {
  path: string;
  score: number | null;
  topPrescriptionId: string | null;
  foldThumbUrl: string | null;
  /** Sum of the open fixes' impact (estimate, else top of range) on this page. */
  opportunity: number;
}

export type ReplayPageListDto = ReplayPageListItemDto[];

/** `POST REPLAY_PATHS.pageCapture?site` body. */
export interface ReplayPageCaptureRequest {
  /** A single page to capture now; omitted → every key page. */
  path?: string | null;
}

/** `POST REPLAY_PATHS.pageCapture` answer: honest about a deploy with no runner. */
export interface ReplayPageCaptureResultDto {
  status: 'queued' | 'unavailable';
  releaseKey: string | null;
  /** Jobs dispatched (pages × devices). */
  queued: number;
  pages: string[];
  /** Why nothing was queued: `runner_unavailable` | `page_kit_unavailable` | `no_pages` | `no_origin`. */
  reason: string | null;
}

/** `GET REPLAY_PATHS.improvementPrompt` / `REPLAY_PATHS.pagePrompt` — compiled on read, never stored. */
export interface ReplayImprovementPromptDto {
  audience: ImprovementAudience;
  prompt: string;
  /** The selectors the prompt changes, in order (the canvas pushes `previewPick` chips for them). */
  selectors: string[];
  prescriptionIds: string[];
}

/** `GET REPLAY_PATHS.previewUrl` — a short-lived signed link to a hosted release. */
export interface ReplayPreviewUrlDto {
  releaseKey: string;
  url: string;
  expiresAt: string;
}

/** The rect map of a capture (`REPLAY_PATHS.capturesAsset` with `asset = rects`). */
export type ReplayRectMapDto = PageRect[];

/** `GET REPLAY_PATHS.sequences?site` — the workspace's sales `sequence` objects a Follow up can enrol into. */
export interface ReplaySequenceChoiceDto {
  id: string;
  name: string;
}

/** `GET REPLAY_PATHS.codingAgents?site` — agents that can take a Fix it task on the site's project. */
export interface ReplayCodingAgentChoiceDto {
  ref: string;
  name: string;
}
