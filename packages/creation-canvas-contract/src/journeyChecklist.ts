/**
 * The JOURNEY CHECKLIST — five launch-gate items a guided campaign run must satisfy
 * before it can leave draft: brand, consent audience, sender/account per chosen
 * channel, offer, copy.
 *
 * ── WHY THIS IS NOT `sendReadiness` ───────────────────────────────────────────────
 * `marketing.ts` `sendReadiness` answers a SEND-TIME question: may this campaign be
 * fired without mailing someone who opted out (suppression, sendable arithmetic,
 * forbidden-claim lint). This module answers a JOURNEY-TIME question: is the run
 * COMPLETE — does it have a brand with a voice, an audience with a consent basis, a
 * sender per channel, an offer, and copy that is present and bound. The two gates are
 * complementary and NEITHER implies the other: a run can be fully configured and still
 * fail `sendReadiness` (suppression never checked), and a run can pass `sendReadiness`
 * while its brand item is `incomplete` (no kit linked).
 *
 * That split is the whole reason this evaluator exists, and it is enforced by
 * construction: this module NEVER imports `sendReadiness`, `campaignSendReadiness`,
 * `sendableCount`, or `forbiddenClaimsIn`. It reads the same shared identifiers
 * (`brandKitRef`, `audienceId`, `consentBasis`, channel, sender id) from the same
 * board objects, because shared inputs are not a shared function.
 *
 * ── WHY A PURE FUNCTION ──────────────────────────────────────────────────────────
 * Two agents (or the same agent twice) evaluating the same run records MUST produce
 * the same statuses and the same reason tokens. That is only guaranteed if the
 * evaluator takes a flat input record and touches nothing else — no database, no API,
 * no clock, no model. The caller assembles `ChecklistEvalInput` from board state; the
 * evaluator is a fold over it. Lint and warning copy live OUTSIDE this function and
 * never change a `status`.
 *
 * ── WHY FIVE ITEMS AND NO ICP ────────────────────────────────────────────────────
 * The checklist gates creative, targeting, and channel-identity completeness. ICP
 * (ideal-customer profile) is deliberately NOT an item: an empty ICP must never fail,
 * incomplete, or block this checklist. Adding it here would make a targeting-hint a
 * launch gate, which is exactly the informal-note failure the checklist exists to
 * remove.
 */

import {
  BRAND_BINDING_FIELD,
  brandRefKey,
  isAffirmativeConsent,
  resolveBrandBinding,
  type BrandBoardObject,
} from './marketing';

// ---------------------------------------------------------------------------
// The item vocabulary
// ---------------------------------------------------------------------------

/** The five items, in evaluation order. There is no sixth. */
export const CHECKLIST_ITEM_IDS = [
  'brand',
  'consentAudience',
  'senderAccount',
  'offer',
  'copy',
] as const;

export type ChecklistItemId = (typeof CHECKLIST_ITEM_IDS)[number];

/**
 * The three states. These map 1:1 to the product vocabulary `missing` | `invalid` |
 * `complete`; there is deliberately no fourth state, because a fourth state is a place
 * a caller can hide a not-quite-pass.
 */
export type ChecklistStatus = 'incomplete' | 'fail' | 'pass';

/**
 * The stable reason tokens. A token is the machine-readable half of `reason`; the
 * human-readable detail is assembled by the caller from `ownerType`/`recordId`, not
 * stored here, so two evaluators can never disagree about what to print.
 *
 * `ok` is shared across items. `not_applicable` is the ONLY non-fail reason that still
 * counts as satisfied for the rollup — see {@link evaluateJourneyChecklist}.
 */
export type ChecklistReason =
  // shared
  | 'ok'
  // brand
  | 'no_brand'
  | 'voice_empty'
  | 'donotsay_missing'
  // consentAudience
  | 'no_audience'
  | 'audience_unresolvable'
  | 'no_consent_basis'
  | 'consent_incompatible_with_channel'
  | 'audience_not_sendable_consent'
  // senderAccount
  | 'no_channel'
  | 'no_sender'
  | 'sender_inactive'
  | 'sender_unverified'
  | 'sender_wrong_channel'
  | 'sender_unauthorized'
  | 'channel_missing_sender'
  // offer
  | 'no_offer'
  | 'offer_incomplete'
  | 'offer_expired'
  | 'offer_inactive'
  | 'not_applicable'
  // copy
  | 'copy_empty'
  | 'copy_wrong_channel'
  | 'copy_missing_fields'
  | 'copy_unbound_brand'
  | 'copy_unbound_offer';

/** The kind of record an item's status was decided by. Null when nothing is linked. */
export type ChecklistOwnerType =
  | 'brandKit'
  | 'audience'
  | 'mailbox'
  | 'socialAccount'
  | 'adsAccount'
  | 'smsSender'
  | 'offer'
  | 'emailCampaign'
  | 'emailTemplate'
  | 'socialCampaign'
  | 'adsCreative';

export interface ChecklistItem {
  itemId: ChecklistItemId;
  status: ChecklistStatus;
  reason: ChecklistReason;
  /** The kind of record that decided this item, or null when nothing is linked. */
  ownerType: ChecklistOwnerType | null;
  /** The id or canvas title-ref of that record, or null when unlinked. */
  recordId: string | null;
  /** The chosen channel this row applies to, or null for run-level items. */
  channel: string | null;
  /** Always true for launch-ready; preview of a single step is the caller's concern. */
  blocking: true;
}

export interface JourneyChecklist {
  items: readonly ChecklistItem[];
  /** True iff every required item is `pass` (with `offer` `not_applicable` counting). */
  ready: boolean;
}

// ---------------------------------------------------------------------------
// The evaluator input
// ---------------------------------------------------------------------------

/**
 * What the evaluator needs to know about one channel's sender. Assembled by the caller
 * from board state (mailbox connections, social/ads connect status). An `undefined`
 * entry for a chosen channel means no sender is linked at all.
 */
export interface SenderChannelInfo {
  /** An identifier the UI can link to — a mailbox connection id, an account handle. */
  id: string | null;
  /** Is this sender active (not revoked, not expired)? */
  active: boolean;
  /** Is this sender verified for the chosen channel (a real sending identity)? */
  verified: boolean;
  /** The channel this sender claims to serve — must match the chosen channel. */
  channelType: string;
  /** Is this sender authorised for this workspace/tenant? Guest boards → false. */
  authorized: boolean;
}

/** What the evaluator needs to know about one channel's copy. */
export interface CopyChannelInfo {
  /** Non-empty body text. */
  body: string;
  /** Subject line. Required for email; ignored otherwise. */
  subject?: string;
  /** Headline. Required for ads; ignored otherwise. */
  headline?: string;
  /** Whether this copy object carries a `brandKitRef` or the board is single-kit. */
  brandBound: boolean;
  /** Whether this copy object is bound to the run's offer (when offer is applicable). */
  offerBound: boolean;
  /** The channel this copy was authored for — must match a chosen channel. */
  channel: string;
}

export interface ChecklistEvalInput {
  /** Board objects, in the shape `resolveBrandBinding` and the audience lookup read. */
  board: readonly BrandBoardObject[];

  /** Run type — decides consent strictness and whether an offer is required. */
  runType: 'promotional' | 'transactional' | 'operational';

  /**
   * The run's chosen send channels, e.g. `['email']` or `['email', 'social']`. These
   * are the actual send surfaces — NOT `CHANNEL_PLATFORMS` (that is agent-host chat).
   */
  channels: readonly string[];

  // ── brand ──
  /** Explicit `brandKitRef` on the run, if set. Falls back to single-kit resolution. */
  brandKitRef?: string | null;

  // ── consentAudience ──
  /** `audienceId` field from the run / campaign. */
  audienceId?: string | null;
  /** `audienceName` field from the run / campaign. */
  audienceName?: string | null;

  // ── senderAccount (per channel) ──
  /** Channel → sender info. A chosen channel with no entry has no sender linked. */
  senders: Record<string, SenderChannelInfo | undefined>;

  // ── offer ──
  /** The offer/CTA string — the minimum the parent contract requires. */
  offerCta?: string | null;
  /** Explicit no-offer flag set by the operator. */
  noOffer?: boolean;
  /** Structured offer id, when a record is linked. */
  offerId?: string | null;
  /** Offer expiry as an ISO-8601 date string, compared against `referenceDate`. */
  offerExpiry?: string | null;
  /** Whether the linked offer record is active. */
  offerActive?: boolean;

  // ── copy (per channel) ──
  /** Channel → copy info for that channel's message step. */
  copy: Record<string, CopyChannelInfo | undefined>;

  /**
   * The "now" the evaluator checks `offerExpiry` against, as an ISO-8601 string. The
   * CALLER supplies it so the evaluator never reads a clock — two evaluations of the
   * same input must agree, and a hidden `Date.now()` is the classic way they stop
   * agreeing.
   */
  referenceDate?: string | null;
}

// ---------------------------------------------------------------------------
// Small helpers — none of them touch state outside their arguments
// ---------------------------------------------------------------------------

function text(raw: unknown): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 ? value : undefined;
}

function item(
  itemId: ChecklistItemId,
  status: ChecklistStatus,
  reason: ChecklistReason,
  ownerType: ChecklistOwnerType | null,
  recordId: string | null,
  channel: string | null,
): ChecklistItem {
  return { itemId, status, reason, ownerType, recordId, channel, blocking: true };
}

/**
 * The audience a run binds to, matched `audienceId` first and `audienceName` title
 * second — the same order `audienceForCampaign` uses, so the checklist and the send
 * path never disagree about WHICH audience a run meant.
 */
function findAudience(input: ChecklistEvalInput): BrandBoardObject | undefined {
  const id = text(input.audienceId);
  const name = text(input.audienceName)?.toLowerCase();
  const audiences = input.board.filter((entry) => entry.kind === 'audience');
  return (
    audiences.find((entry) => id && text(entry.data.audienceId) === id) ??
    audiences.find(
      (entry) =>
        name &&
        (text(entry.title)?.toLowerCase() === name ||
          text(entry.data.title)?.toLowerCase() === name),
    ) ??
    undefined
  );
}

// ---------------------------------------------------------------------------
// Item 1 — brand
// ---------------------------------------------------------------------------

/**
 * Brand = voice AND doNotSay list PRESENCE on a resolved `brandKit`. Not lint, not
 * palette, not logo. An authored empty `doNotSay: []` is a valid list ("nothing
 * forbidden"); an ABSENT field is not. That distinction is the parent contract's and
 * is the whole reason this checks `undefined` rather than length.
 */
function evaluateBrand(input: ChecklistEvalInput): ChecklistItem {
  // Resolve through the SAME function the compose path uses, keyed on the SAME field,
  // so the checklist and the generator can never disagree about which kit is in force.
  const ref = input.brandKitRef ?? undefined;
  const binding = resolveBrandBinding(
    { data: { [BRAND_BINDING_FIELD]: ref } },
    input.board,
  );
  if (!binding) {
    return item('brand', 'incomplete', 'no_brand', null, null, null);
  }
  if (!text(binding.voice)) {
    return item('brand', 'fail', 'voice_empty', 'brandKit', binding.name, null);
  }

  // `resolveBrandBinding` normalises `doNotSay` to an array and MERGES the board's
  // battlecard claims in, so a never-authored field and an authored `[]` are
  // indistinguishable on the binding. The parent contract distinguishes them — an
  // authored empty list means "nothing forbidden" and passes, a missing field means the
  // list was never written and fails — so presence is read off the KIT itself, matched
  // by the same three rules and the same casing rule the resolver used.
  const kits = input.board.filter((entry) => entry.kind === 'brandKit');
  const refKey = brandRefKey(ref);
  const kit = refKey
    ? kits.find(
        (entry) =>
          brandRefKey(entry.title) === refKey || brandRefKey(entry.data.title) === refKey,
      )
    : kits.length === 1
      ? kits[0]
      : undefined;
  const rawDoNotSay = kit?.data.doNotSay;
  if (rawDoNotSay === undefined || rawDoNotSay === null) {
    return item('brand', 'fail', 'donotsay_missing', 'brandKit', binding.name, null);
  }
  return item('brand', 'pass', 'ok', 'brandKit', binding.name, null);
}

// ---------------------------------------------------------------------------
// Item 2 — consentAudience
// ---------------------------------------------------------------------------

/**
 * Consent audience = a named audience with a consent basis compatible with the run's
 * purpose and channel. This is SELECTION + basis only. It NEVER reads
 * `suppressedCount`, never computes a sendable number, and never emits
 * `noSuppressionCheck` — those belong to `sendReadiness`.
 */
function evaluateConsentAudience(input: ChecklistEvalInput): ChecklistItem {
  const hasRef = Boolean(text(input.audienceId) || text(input.audienceName));
  if (!hasRef) {
    return item('consentAudience', 'incomplete', 'no_audience', null, null, null);
  }
  const audience = findAudience(input);
  if (!audience) {
    return item(
      'consentAudience',
      'fail',
      'audience_unresolvable',
      null,
      text(input.audienceId) ?? text(input.audienceName) ?? null,
      null,
    );
  }
  const recordId = text(audience.data.audienceId) ?? text(audience.title) ?? null;
  if (audience.data.nonSendableConsent === true) {
    return item('consentAudience', 'fail', 'audience_not_sendable_consent', 'audience', recordId, null);
  }
  const basis = text(audience.data.consentBasis);
  if (!basis || basis === 'unknown') {
    return item('consentAudience', 'fail', 'no_consent_basis', 'audience', recordId, null);
  }

  const promotional = input.runType === 'promotional';
  // Promotional email/sms demands an affirmative act by the person. Transactional and
  // operational runs may lawfully rest on `contractual`, and on `legitimateInterest`
  // when the run is non-promotional. `imported` never passes — it is a basis that may
  // be defensible and is not consent.
  let compatible: boolean;
  if (promotional) {
    compatible = isAffirmativeConsent(basis);
  } else if (basis === 'contractual' || basis === 'legitimateInterest') {
    compatible = true;
  } else if (isAffirmativeConsent(basis)) {
    compatible = true;
  } else {
    compatible = false;
  }
  if (!compatible) {
    return item(
      'consentAudience',
      'fail',
      'consent_incompatible_with_channel',
      'audience',
      recordId,
      null,
    );
  }
  return item('consentAudience', 'pass', 'ok', 'audience', recordId, null);
}

// ---------------------------------------------------------------------------
// Item 3 — senderAccount (channel-aware, single item)
// ---------------------------------------------------------------------------

/** The owner type a sender failure maps to, from the channel it failed on. */
function senderOwnerType(channel: string): ChecklistOwnerType {
  switch (channel) {
    case 'email':
      return 'mailbox';
    case 'sms':
      return 'smsSender';
    case 'social':
      return 'socialAccount';
    case 'ads':
      return 'adsAccount';
    default:
      return 'mailbox';
  }
}

/**
 * Sender/account per chosen channel. ONE item even on a multi-channel run: the item is
 * `pass` only when EVERY chosen channel has an active, verified, correctly-typed,
 * authorised sender. The reason reflects the first failing channel in declaration
 * order so the rejection payload is stable across evaluators.
 */
function evaluateSenderAccount(input: ChecklistEvalInput): ChecklistItem {
  if (input.channels.length === 0) {
    return item('senderAccount', 'incomplete', 'no_channel', null, null, null);
  }
  for (const channel of input.channels) {
    const sender = input.senders[channel];
    if (!sender || !text(sender.id)) {
      // A chosen channel with no sender linked is incomplete, not fail — the operator
      // simply has not connected one yet.
      return item('senderAccount', 'incomplete', 'no_sender', senderOwnerType(channel), null, channel);
    }
    const recordId = text(sender.id) ?? null;
    if (sender.channelType !== channel) {
      return item('senderAccount', 'fail', 'sender_wrong_channel', senderOwnerType(channel), recordId, channel);
    }
    if (!sender.authorized) {
      return item('senderAccount', 'fail', 'sender_unauthorized', senderOwnerType(channel), recordId, channel);
    }
    if (!sender.active) {
      return item('senderAccount', 'fail', 'sender_inactive', senderOwnerType(channel), recordId, channel);
    }
    if (!sender.verified) {
      return item('senderAccount', 'fail', 'sender_unverified', senderOwnerType(channel), recordId, channel);
    }
  }
  return item('senderAccount', 'pass', 'ok', null, null, null);
}

// ---------------------------------------------------------------------------
// Item 4 — offer
// ---------------------------------------------------------------------------

/**
 * Offer = a non-empty offer/CTA, or an explicit no-offer / transactional run. There is
 * no marketing Offer table on main today, so the structured fields (`offerId`,
 * `offerExpiry`, `offerActive`) are evaluated ONLY when present — the parent contract
 * minimum is the non-empty string, and inventing a merchandising product is out of
 * scope.
 */
function evaluateOffer(input: ChecklistEvalInput): ChecklistItem {
  const notApplicable =
    input.noOffer === true ||
    input.runType === 'transactional' ||
    input.runType === 'operational';
  if (notApplicable) {
    return item('offer', 'pass', 'not_applicable', null, text(input.offerId) ?? null, null);
  }

  const cta = text(input.offerCta);
  const recordId = text(input.offerId) ?? null;
  if (!cta) {
    return item('offer', 'incomplete', 'no_offer', null, recordId, null);
  }
  // Structured checks only apply when a structured offer is actually linked.
  if (recordId) {
    if (input.offerActive === false) {
      return item('offer', 'fail', 'offer_inactive', 'offer', recordId, null);
    }
    const expiry = text(input.offerExpiry);
    const reference = text(input.referenceDate);
    if (expiry && reference && expiry < reference) {
      return item('offer', 'fail', 'offer_expired', 'offer', recordId, null);
    }
  }
  return item('offer', 'pass', 'ok', recordId ? 'offer' : null, recordId, null);
}

// ---------------------------------------------------------------------------
// Item 5 — copy (channel-aware, single item)
// ---------------------------------------------------------------------------

/** The owner type a copy failure maps to, from the channel it failed on. */
function copyOwnerType(channel: string): ChecklistOwnerType {
  switch (channel) {
    case 'email':
      return 'emailCampaign';
    case 'social':
      return 'socialCampaign';
    case 'ads':
      return 'adsCreative';
    default:
      return 'emailCampaign';
  }
}

/**
 * Copy = presence and binding. Every chosen channel's message step must have a
 * non-empty body, the channel-required fields (email subject, ads headline), and a
 * brand binding; an offer binding too when the offer item is applicable.
 *
 * This item deliberately does NOT run the doNotSay linter. A forbidden-claim HIT is a
 * `sendReadiness.forbiddenClaim` blocker — putting the same hit on checklist `copy`
 * would merge the two gates this module exists to split. Presence is the question
 * here; enforcement is send-time.
 */
function evaluateCopy(
  input: ChecklistEvalInput,
  brandItem: ChecklistItem,
  offerItem: ChecklistItem,
): ChecklistItem {
  if (input.channels.length === 0) {
    return item('copy', 'incomplete', 'copy_empty', null, null, null);
  }
  const offerApplicable = offerItem.reason !== 'not_applicable';
  const brandRequired = brandItem.reason !== 'not_applicable';

  for (const channel of input.channels) {
    const copy = input.copy[channel];
    const ownerType = copyOwnerType(channel);
    if (!copy || !text(copy.body)) {
      return item('copy', 'incomplete', 'copy_empty', ownerType, null, channel);
    }
    const recordId = channel; // copy is identified by the channel step it belongs to
    if (copy.channel !== channel) {
      return item('copy', 'fail', 'copy_wrong_channel', ownerType, recordId, channel);
    }
    if (channel === 'email' && !text(copy.subject)) {
      return item('copy', 'fail', 'copy_missing_fields', ownerType, recordId, channel);
    }
    if (channel === 'ads' && !text(copy.headline)) {
      return item('copy', 'fail', 'copy_missing_fields', ownerType, recordId, channel);
    }
    if (brandRequired && !copy.brandBound) {
      return item('copy', 'fail', 'copy_unbound_brand', ownerType, recordId, channel);
    }
    if (offerApplicable && !copy.offerBound) {
      return item('copy', 'fail', 'copy_unbound_offer', ownerType, recordId, channel);
    }
  }
  return item('copy', 'pass', 'ok', null, null, null);
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the five journey-checklist items for one guided campaign run.
 *
 * Pure and deterministic: same input → same items, same order, same reason tokens. The
 * `offer` item is evaluated before `copy` because copy's offer-binding rule needs to
 * know whether an offer is applicable; `brand` is evaluated first for the same reason.
 * Item ORDER in the result is always the `CHECKLIST_ITEM_IDS` declaration order,
 * regardless of evaluation dependency order.
 */
export function evaluateJourneyChecklist(input: ChecklistEvalInput): JourneyChecklist {
  const brand = evaluateBrand(input);
  const consentAudience = evaluateConsentAudience(input);
  const senderAccount = evaluateSenderAccount(input);
  const offer = evaluateOffer(input);
  const copy = evaluateCopy(input, brand, offer);

  const items: ChecklistItem[] = [brand, consentAudience, senderAccount, offer, copy];
  const ready = items.every(
    (entry) => entry.status === 'pass' || entry.reason === 'not_applicable',
  );
  return { items, ready };
}

/**
 * The non-pass required items, in the shape a launch-gate rejection carries. The
 * caller refuses to advance the run and returns this list; it never silently coerces
 * and there is no partial go-live.
 */
export function checklistBlockers(
  checklist: JourneyChecklist,
): ReadonlyArray<Pick<ChecklistItem, 'itemId' | 'status' | 'reason'>> {
  return checklist.items
    .filter((entry) => !(entry.status === 'pass' || entry.reason === 'not_applicable'))
    .map(({ itemId, status, reason }) => ({ itemId, status, reason }));
}
