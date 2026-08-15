/**
 * Build, stage, live — client side.
 *
 * Transport only. The vocabulary that decides what a release IS (`harness`, the four
 * states, what counts as a blocker) comes from
 * `@builderforce/creation-canvas-contract`, the same module the API validates
 * against, so the panel's verdict and the server's gate cannot disagree. A client
 * that re-derived "may I publish" from a list of findings is a client that can be
 * told to decide differently.
 */

import { apiRequest } from './apiClient';
import type {
  ListingHarness,
  ListingReleaseState,
  StageCheck,
} from '@builderforce/creation-canvas-contract';

export interface ReleaseView {
  /** Null on the DRAFT row — the board has moved on and nothing is captured. */
  snapshotId: string | null;
  version: string;
  state: ListingReleaseState;
  takenAtISO: string | null;
  /** Buyers pinned to this exact version. What makes a revert a decision. */
  holders: number;
}

export interface ReleaseRail {
  listingId: string | null;
  slug: string | null;
  kind: string | null;
  harness: ListingHarness | null;
  live: boolean;
  releases: ReleaseView[];
}

export interface StagedRelease {
  snapshotId: string;
  version: string;
  harness: ListingHarness;
  checks: StageCheck[];
  payload: {
    kind: 'object' | 'session';
    title: string;
    objects: Array<{ id: string; kind: string; canvasData: unknown; content: unknown }>;
    strippedFields?: string[];
  };
}

/** What staging needs to know. The same shape publish takes, because the same
 *  validation decides both — a card must be stageable as exactly the kinds it is
 *  publishable as. */
export interface StageRequest {
  sessionId: string;
  objectId: string | null;
  kind: string;
  name: string;
  summary?: string;
  priceCents?: number;
  currency?: string;
  trial?: string;
  listingId?: string | null;
}

const BASE = '/api/creation-listings/releases';

export const creationReleaseApi = {
  /** Every version behind this card, newest first. */
  rail: (sessionId: string, objectId: string | null) =>
    apiRequest<{ rail: ReleaseRail }>(
      `${BASE}/${sessionId}${objectId ? `?objectId=${encodeURIComponent(objectId)}` : ''}`,
    ).then((r) => r.rail),

  /** Capture a candidate and run its harness. Publishes nothing. */
  stage: (input: StageRequest) =>
    apiRequest<{ staged: StagedRelease }>(`${BASE}/stage`, {
      method: 'POST',
      body: JSON.stringify(input),
      expectedErrors: [400, 404],
    }).then((r) => r.staged),

  /**
   * Re-read an existing candidate's findings.
   *
   * Deliberately not the same call as `stage`: reopening the panel must not
   * re-capture, or the version a seller thought they were about to publish quietly
   * becomes today's board instead of the build they checked.
   */
  staged: (sessionId: string, objectId: string | null, snapshotId: string) =>
    apiRequest<{ staged: StagedRelease }>(
      `${BASE}/${sessionId}/staged/${snapshotId}${objectId ? `?objectId=${encodeURIComponent(objectId)}` : ''}`,
      { expectedErrors: [404] },
    ).then((r) => r.staged),

  /** Put an earlier version back on sale. Existing buyers are not moved. */
  revert: (listingId: string, snapshotId: string) =>
    apiRequest<{ reverted: { version: string; snapshotId: string } }>(`${BASE}/revert`, {
      method: 'POST',
      body: JSON.stringify({ listingId, snapshotId }),
      expectedErrors: [400, 403, 404, 409],
    }).then((r) => r.reverted),
};
