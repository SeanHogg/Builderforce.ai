/**
 * The page-review slice of the Insights client (PRD 33 §5.2, §8 S4f) — spread into
 * `replayApi` like the prescriptions and analysis halves, so components keep ONE
 * client. Paths are `REPLAY_PATHS`, shapes the shared DTOs (`replayPageRoutes.ts`
 * produces them).
 *
 * Screenshots are member-authorised API routes: an `<img src>` would carry no
 * bearer, so `captureAssetUrl` fetches through the shared transport and hands back
 * an object URL (never a token in a URL). The caller revokes it.
 */

import {
  REPLAY_PATHS,
  type ImprovementAudience,
  type ReplayCodingAgentChoiceDto,
  type ReplayImprovementPromptDto,
  type ReplayPageCaptureResultDto,
  type ReplayPageListDto,
  type ReplayPageReviewDto,
  type ReplayPreviewUrlDto,
  type ReplayRectMapDto,
  type ReplaySequenceChoiceDto,
} from '@builderforce/interaction-contract';
import { apiRequest, apiRequestStream } from './apiClient';
import { fill, listOf, shared, withQuery } from './replayHttp';

/** "Capture now" ran within the hour: the API answers 429 and the review says so. */
export const PAGE_CAPTURE_LIMIT_STATUS = 429;

/** What `capturesAsset` serves for one capture (`after-*` need the fix's id). */
export type ReplayCaptureAsset = 'screenshot' | 'fold' | 'rects' | 'after-desktop' | 'after-phone';

export const replayPageApi = {
  /** The key pages, scored, with their top fix and fold thumbnail. */
  listPages(siteId: string): Promise<ReplayPageListDto> {
    const url = withQuery(REPLAY_PATHS.pages, siteId);
    return shared(url, async () => listOf(await apiRequest<ReplayPageListDto | { items: ReplayPageListDto }>(url)));
  },

  /** One page: captures (newest release first, both devices), its fixes and its score by release. */
  pageReview(siteId: string, path: string): Promise<ReplayPageReviewDto> {
    const url = withQuery(REPLAY_PATHS.pageReview, siteId, { path });
    return shared(url, () => apiRequest<ReplayPageReviewDto>(url));
  },

  /** "Request a capture now" (MANAGER, once an hour per site — 429 otherwise). Omit `path` for every key page. */
  requestPageCapture(siteId: string, path?: string | null): Promise<ReplayPageCaptureResultDto> {
    return apiRequest<ReplayPageCaptureResultDto>(withQuery(REPLAY_PATHS.pageCapture, siteId), {
      method: 'POST',
      body: JSON.stringify({ path: path ?? null }),
      expectedErrors: [PAGE_CAPTURE_LIMIT_STATUS],
    });
  },

  /** The API path of one capture asset (`after-*` carry the fix's id). Never put in an `src`: it needs the bearer. */
  captureAssetPath(siteId: string, captureId: string, asset: ReplayCaptureAsset, prescriptionId?: string | null): string {
    return withQuery(fill(REPLAY_PATHS.capturesAsset, { captureId, asset }), siteId, { prescription: prescriptionId ?? null });
  },

  /**
   * An authorised capture asset (a `capturesAsset` path, as the DTOs carry them) as an
   * object URL for an `<img>`. The caller MUST revoke it when finished.
   */
  async captureAssetUrl(assetPath: string): Promise<string> {
    const res = await apiRequestStream(assetPath);
    if (!res.ok) throw new Error(`replay capture asset: ${res.status}`);
    return URL.createObjectURL(await res.blob());
  },

  /** A capture's rect map — where each element the review saw sits on the screenshot. */
  captureRects(siteId: string, captureId: string): Promise<ReplayRectMapDto> {
    const url = replayPageApi.captureAssetPath(siteId, captureId, 'rects');
    return shared(url, async () => listOf(await apiRequest<ReplayRectMapDto | { items: ReplayRectMapDto }>(url)));
  },

  /** One fix's improvement prompt for an audience (compiled on read, never stored). */
  improvementPrompt(siteId: string, prescriptionId: string, audience: ImprovementAudience): Promise<ReplayImprovementPromptDto> {
    const url = withQuery(fill(REPLAY_PATHS.improvementPrompt, { prescriptionId }), siteId, { audience });
    return shared(url, () => apiRequest<ReplayImprovementPromptDto>(url));
  },

  /** One prompt for the accepted fixes on a page — every one, or only `ids`. */
  pagePrompt(siteId: string, path: string, audience: ImprovementAudience, ids?: readonly string[] | null): Promise<ReplayImprovementPromptDto> {
    const url = withQuery(REPLAY_PATHS.pagePrompt, siteId, { path, audience, ids: ids && ids.length > 0 ? ids.join(',') : null });
    return shared(url, () => apiRequest<ReplayImprovementPromptDto>(url));
  },

  /** A short-lived signed link to a hosted release before it is published. */
  previewUrl(siteId: string, releaseKey: string): Promise<ReplayPreviewUrlDto> {
    return apiRequest<ReplayPreviewUrlDto>(withQuery(fill(REPLAY_PATHS.previewUrl, { releaseKey }), siteId));
  },

  /** The sales sequences a Follow up can enrol into. */
  listSequences(siteId: string): Promise<ReplaySequenceChoiceDto[]> {
    const url = withQuery(REPLAY_PATHS.sequences, siteId);
    return shared(url, async () => listOf(await apiRequest<ReplaySequenceChoiceDto[] | { items: ReplaySequenceChoiceDto[] }>(url)));
  },

  /** The coding agents that can take a Fix it on the site's project (empty for an external site). */
  listCodingAgents(siteId: string): Promise<ReplayCodingAgentChoiceDto[]> {
    const url = withQuery(REPLAY_PATHS.codingAgents, siteId);
    return shared(url, async () => listOf(await apiRequest<ReplayCodingAgentChoiceDto[] | { items: ReplayCodingAgentChoiceDto[] }>(url)));
  },
};
