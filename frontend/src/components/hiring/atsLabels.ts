/**
 * The words the hiring surface puts against the ATS's closed vocabularies.
 *
 * `ats.decision.kind.*`, `ats.offer.status.*` and `ats.kits.kind.*` are message keys
 * built from values that come off the wire, which `check-i18n-keys.mjs` cannot see —
 * so the labelled set is stated once (`lib/hiringApi.ts`) and asserted against the five
 * catalogs by `atsLabels.test.ts`. These helpers are the ONLY way a component turns a
 * wire value into one of those keys: a value outside the labelled set gets `null`, and
 * the caller renders the value verbatim, the way a free-form stage name already is —
 * never a dotted key masquerading as a chip.
 *
 * The status subsets live here too, typed against the same constant, so "an offer
 * that is still in play" and "an offer that can still be edited" are declared once
 * rather than as `||` chains in two panels that would drift the day a status is added.
 */

import {
  ATS_LABELLED_DECISIONS,
  ATS_LABELLED_KIT_STAGE_KINDS,
  ATS_LABELLED_OFFER_STATUSES,
} from '@/lib/hiringApi';

export type LabelledDecision = (typeof ATS_LABELLED_DECISIONS)[number];
export type LabelledOfferStatus = (typeof ATS_LABELLED_OFFER_STATUSES)[number];
export type LabelledKitStageKind = (typeof ATS_LABELLED_KIT_STAGE_KINDS)[number];

export type DecisionLabelKey = `decision.kind.${LabelledDecision}`;
export type OfferStatusLabelKey = `offer.status.${LabelledOfferStatus}`;
export type KitStageLabelKey = `kits.kind.${LabelledKitStageKind}`;

export function isLabelledDecision(value: string): value is LabelledDecision {
  return (ATS_LABELLED_DECISIONS as readonly string[]).includes(value);
}

export function isLabelledOfferStatus(value: string): value is LabelledOfferStatus {
  return (ATS_LABELLED_OFFER_STATUSES as readonly string[]).includes(value);
}

export function isLabelledKitStageKind(value: string): value is LabelledKitStageKind {
  return (ATS_LABELLED_KIT_STAGE_KINDS as readonly string[]).includes(value);
}

/** The `ats.*` message key for a decision, or `null` for one the catalogs have no word for. */
export function decisionLabelKey(decision: string): DecisionLabelKey | null {
  return isLabelledDecision(decision) ? `decision.kind.${decision}` : null;
}

/** The `ats.*` message key for an offer status, or `null` for one the catalogs have no word for. */
export function offerStatusLabelKey(status: string): OfferStatusLabelKey | null {
  return isLabelledOfferStatus(status) ? `offer.status.${status}` : null;
}

/** The `ats.*` message key for an interview-kit stage kind, or `null` for one the catalogs have no word for. */
export function kitStageLabelKey(kind: string): KitStageLabelKey | null {
  return isLabelledKitStageKind(kind) ? `kits.kind.${kind}` : null;
}

/**
 * Offers still in play: not yet answered by the candidate and not lapsed. The one a
 * drawer shows the send-for-signature form for.
 */
export const LIVE_OFFER_STATUSES: readonly LabelledOfferStatus[] = ['draft', 'approved', 'sent'];

/** Offers whose terms can still change — once sent, the document is what was signed. */
export const EDITABLE_OFFER_STATUSES: readonly LabelledOfferStatus[] = ['draft', 'approved'];

export function isLiveOfferStatus(status: string): boolean {
  return (LIVE_OFFER_STATUSES as readonly string[]).includes(status);
}

export function isEditableOfferStatus(status: string): boolean {
  return (EDITABLE_OFFER_STATUSES as readonly string[]).includes(status);
}
