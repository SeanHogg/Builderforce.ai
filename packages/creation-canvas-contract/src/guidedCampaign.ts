/**
 * The GUIDED CAMPAIGN RUN — the founder journey from "I want to run a
 * marketing campaign", composed on top of the brand binding and send-readiness
 * this package already owns.
 *
 * sendReadiness answers "may this email lawfully be fired from the board?"
 * (audience named, affirmative consent, suppression retrieved, no forbidden
 * claim). That is the operational Growth gate. It is not the journey
 * checklist a founder walks: brand (voice + doNotSay), consenting audience,
 * sender/account for the chosen channel, offer/CTA, copy that passed the
 * brand-voice check.
 *
 * Drafting is allowed with gaps. Send / schedule / publish / spend requires
 * every channel-relevant checklist item PLUS an explicit human confirm from
 * a signed-in user. Anonymous boards and cloud agents may author; they may
 * not send.
 *
 * Campaign ROI is spend and/or pipeline/revenue attributed to THIS run.
 * Opens, clicks, and workspace `/api/roi/rollup` are not it. Until a later
 * slice lands the attribution engine, the honest answer is `unknown` — never
 * a number invented from engagement.
 */

import {
  forbiddenClaimsIn,
  isAffirmativeConsent,
  sendReadiness,
  type BrandBinding,
  type SendReadiness,
} from './marketing';

export const GUIDED_CAMPAIGN_STAGES = [
  'intake',
  'checklist',
  'connect',
  'copy',
  'confirm',
  'track',
] as const;

export type GuidedCampaignStage = (typeof GUIDED_CAMPAIGN_STAGES)[number];

export const GUIDED_CAMPAIGN_CHANNELS = ['email', 'sms', 'social', 'ads'] as const;

export type GuidedCampaignChannel = (typeof GUIDED_CAMPAIGN_CHANNELS)[number];

export const JOURNEY_CHECKLIST_ITEMS = [
  'brand',
  'audience',
  'sender',
  'offer',
  'copy',
] as const;

export type JourneyChecklistItem = (typeof JOURNEY_CHECKLIST_ITEMS)[number];

export interface GuidedCampaignIntake {
  business?: string;
  vertical?: string;
  /** Optional. Missing ICP must not block drafting or sending. */
  icp?: string;
  offer?: string;
  goal?: string;
  channels: readonly GuidedCampaignChannel[];
}

export interface JourneyItemState {
  item: JourneyChecklistItem;
  ready: boolean;
  reason: string;
}

export interface JourneyChecklist {
  items: readonly JourneyItemState[];
  /** True when every channel-relevant item is ready. Does not imply send. */
  ready: boolean;
}

/**
 * Sender / account presence for the chosen channel. The contract does not
 * talk to OAuth — the adapter reports what Growth / Canvas already know.
 */
export interface ChannelAccounts {
  email?: boolean;
  sms?: boolean;
  social?: boolean;
  ads?: boolean;
}

export interface CampaignRoi {
  /**
   * `unknown` until attributed spend and/or pipeline/revenue exist for THIS
   * campaign. Never derived from opens/clicks.
   */
  status: 'unknown' | 'attributed';
  spendCents?: number;
  attributedRevenueCents?: number;
  /** Present only when both spend and attributed revenue are known. */
  roas?: number;
}

export interface GuidedCampaignRun {
  stage: GuidedCampaignStage;
  intake: GuidedCampaignIntake;
  checklist: JourneyChecklist;
  /** Operational Growth blockers — distinct from the journey checklist. */
  sendReadiness: SendReadiness;
  copyReady: boolean;
  humanConfirmed: boolean;
  persistence: 'local' | 'server';
  /** Anonymous boards and cloud agents may author; they may not send. */
  maySend: boolean;
  roi: CampaignRoi;
}

export interface JourneyChecklistInput {
  brand: BrandBinding | null;
  audienceName?: string | null;
  /** Canvas `consentBasis` (`optIn` / `doubleOptIn` are the affirmative pair). */
  audienceConsent?: string | null;
  accounts: ChannelAccounts;
  intake: GuidedCampaignIntake;
  copyBody?: string | null;
}

export interface GuidedCampaignRunInput extends JourneyChecklistInput {
  audienceId?: unknown;
  size?: unknown;
  suppressedCount?: unknown;
  /**
   * Convenience for tests / adapters that only know "was the list retrieved".
   * When true and `suppressedCount` is omitted, treated as a retrieved zero.
   * When false/omitted, sendReadiness still raises `noSuppressionCheck`.
   */
  suppressionRetrieved?: boolean;
  copySubject?: string | null;
  persistence: 'local' | 'server';
  humanConfirmed?: boolean;
  /** Cloud / autonomous agents stay draft-only. */
  agentDraftOnly?: boolean;
  /** True after an existing send / publish / ads launch for this run. */
  launched?: boolean;
  stage?: GuidedCampaignStage;
  engagement?: {
    sent?: number;
    opened?: number;
    clicked?: number;
  };
  /** Workspace-level `/api/roi/rollup` — ignored for campaign ROI. */
  workspaceRoi?: unknown;
  spendCents?: number;
  attributedRevenueCents?: number;
  attributedPipelineCents?: number;
}

const RUN_INTENT =
  /\b(?:i\s+want\s+to\s+)?(?:run|launch|start|send|create)\b[\s\S]{0,48}\b(?:marketing\s+)?campaign\b/i;
const CONNECT_AND_RUN =
  /\bconnect\b[\s\S]{0,48}\b(?:email|inbox|mailbox)\b[\s\S]{0,48}\bcampaign\b/i;
const LIST_INTENT =
  /\b(?:list|show|see|view|open)\b[\s\S]{0,32}\b(?:my\s+|existing\s+|the\s+)?campaigns\b/i;
const PORTFOLIO_INTENT = /\bcampaign\s+portfolio\b|\bportfolio\s+of\s+campaigns\b/i;

function nonempty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteCents(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function channelsOf(intake: GuidedCampaignIntake): GuidedCampaignChannel[] {
  const seen = new Set<GuidedCampaignChannel>();
  for (const channel of intake.channels ?? []) {
    if ((GUIDED_CAMPAIGN_CHANNELS as readonly string[]).includes(channel)) {
      seen.add(channel);
    }
  }
  return seen.size > 0 ? [...seen] : ['email'];
}

function senderReady(accounts: ChannelAccounts, channels: readonly GuidedCampaignChannel[]): boolean {
  return channels.every((channel) => accounts[channel] === true);
}

function senderReason(accounts: ChannelAccounts, channels: readonly GuidedCampaignChannel[]): string {
  const missing = channels.filter((channel) => accounts[channel] !== true);
  if (missing.length === 0) {
    return 'Sender / account connected for every chosen channel.';
  }
  return `Connect ${missing.join(', ')} before send — drafting is allowed.`;
}

function brandReady(brand: BrandBinding | null): boolean {
  return Boolean(brand)
    && nonempty(brand?.voice)
    && Array.isArray(brand?.doNotSay)
    && brand!.doNotSay.length > 0;
}

function copyHaystack(subject: string | null | undefined, body: string | null | undefined): string {
  return [subject, body].filter((part) => typeof part === 'string' && part.trim()).join('\n');
}

/**
 * True when the prompt is asking to RUN a campaign, not to list the
 * existing ones. Run wins over list when both could match ("show me how
 * to run a campaign").
 */
export function isCampaignRunIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return RUN_INTENT.test(trimmed) || CONNECT_AND_RUN.test(trimmed);
}

/** True when the prompt is asking to list / inspect existing campaigns. */
export function isCampaignListIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isCampaignRunIntent(trimmed)) return false;
  return LIST_INTENT.test(trimmed) || PORTFOLIO_INTENT.test(trimmed);
}

/**
 * Copy is checklist-ready when a draft exists and no brand doNotSay phrase
 * appears in it. Voice is a generation constraint, not a second gate. A
 * missing brand does not block drafting — the brand checklist item still
 * refuses send.
 */
export function copyPassesBrand(body: string | null | undefined, brand: BrandBinding | null): boolean {
  if (!nonempty(body)) return false;
  if (!brand) return true;
  return forbiddenClaimsIn(body, brand).length === 0;
}

/**
 * Journey checklist — advisory for drafting. Distinct from sendReadiness:
 * an audience without a retrieved suppression list is journey-ready on the
 * audience item and still send-blocked.
 */
export function journeyChecklist(input: JourneyChecklistInput): JourneyChecklist {
  const channels = channelsOf(input.intake);
  const kitReady = brandReady(input.brand);
  const audienceReady =
    nonempty(input.audienceName) && isAffirmativeConsent(input.audienceConsent);
  const senderIsReady = senderReady(input.accounts, channels);
  const offerReady = nonempty(input.intake.offer);
  const copyReady = copyPassesBrand(input.copyBody, input.brand);

  const items: JourneyItemState[] = [
    {
      item: 'brand',
      ready: kitReady,
      reason: kitReady
        ? 'Brand kit has voice and doNotSay.'
        : 'Brand kit needs a voice and a doNotSay list before copy is checklist-ready.',
    },
    {
      item: 'audience',
      ready: audienceReady,
      reason: audienceReady
        ? 'Live audience with affirmative consent.'
        : 'Name a live audience whose consent is optIn or doubleOptIn.',
    },
    {
      item: 'sender',
      ready: senderIsReady,
      reason: senderReason(input.accounts, channels),
    },
    {
      item: 'offer',
      ready: offerReady,
      reason: offerReady
        ? 'Offer / CTA captured in intake.'
        : 'Capture the offer / CTA in intake. ICP is optional and is not a gate.',
    },
    {
      item: 'copy',
      ready: copyReady,
      reason: copyReady
        ? 'Draft copy passed the brand doNotSay check.'
        : nonempty(input.copyBody)
          ? 'Draft copy still contains a doNotSay phrase.'
          : 'Author a draft against brand voice. Regeneration stays in draft.',
    },
  ];

  return { items, ready: items.every((item) => item.ready) };
}

/**
 * Campaign-attributed ROI. Opens, clicks, sent, and workspace rollup are
 * accepted so callers cannot accidentally promote them: they are ignored.
 */
export function campaignRoi(input: {
  opens?: number;
  clicks?: number;
  sent?: number;
  workspaceRoi?: unknown;
  spendCents?: number;
  attributedRevenueCents?: number;
  attributedPipelineCents?: number;
}): CampaignRoi {
  const spend = finiteCents(input.spendCents);
  const revenue =
    finiteCents(input.attributedRevenueCents) ?? finiteCents(input.attributedPipelineCents);
  if (spend === undefined && revenue === undefined) {
    return { status: 'unknown' };
  }
  const roi: CampaignRoi = { status: 'attributed' };
  if (spend !== undefined) roi.spendCents = spend;
  if (revenue !== undefined) roi.attributedRevenueCents = revenue;
  if (spend !== undefined && spend > 0 && revenue !== undefined) {
    roi.roas = revenue / spend;
  }
  return roi;
}

function defaultStage(input: {
  checklist: JourneyChecklist;
  copyReady: boolean;
  launched: boolean;
  roi: CampaignRoi;
}): GuidedCampaignStage {
  if (input.launched || input.roi.status === 'attributed') return 'track';
  if (input.copyReady && input.checklist.ready) return 'confirm';
  if (input.copyReady) return 'copy';
  const sender = input.checklist.items.find((item) => item.item === 'sender');
  const offer = input.checklist.items.find((item) => item.item === 'offer');
  const brand = input.checklist.items.find((item) => item.item === 'brand');
  if (offer && !offer.ready) return 'intake';
  if (sender && !sender.ready) return 'connect';
  if (brand && !brand.ready) return 'checklist';
  return 'checklist';
}

/**
 * Compose the guided run. Connect success never implies send. Empty ICP
 * never blocks. Human confirm from a signed-in, non-agent actor is the
 * only thing that flips `maySend`. `maySend` does not itself mean the
 * campaign launched — that is `launched`.
 */
export function guidedCampaignRun(input: GuidedCampaignRunInput): GuidedCampaignRun {
  const intake: GuidedCampaignIntake = {
    ...input.intake,
    channels: channelsOf(input.intake),
  };
  const checklist = journeyChecklist({
    brand: input.brand,
    audienceName: input.audienceName,
    audienceConsent: input.audienceConsent,
    accounts: input.accounts,
    intake,
    copyBody: input.copyBody,
  });
  const copyReady = copyPassesBrand(input.copyBody, input.brand);
  const haystack = copyHaystack(input.copySubject, input.copyBody);
  const suppressedCount =
    input.suppressedCount !== undefined && input.suppressedCount !== null && input.suppressedCount !== ''
      ? input.suppressedCount
      : input.suppressionRetrieved === true
        ? 0
        : undefined;
  const operational = sendReadiness({
    audienceId: input.audienceId,
    audienceName: input.audienceName,
    size: input.size,
    suppressedCount,
    consentBasis: input.audienceConsent,
    forbiddenClaims: forbiddenClaimsIn(haystack, input.brand ?? undefined),
  });
  const humanConfirmed = input.humanConfirmed === true;
  const maySend =
    input.persistence === 'server' &&
    input.agentDraftOnly !== true &&
    humanConfirmed &&
    checklist.ready &&
    operational.ready;
  const roi = campaignRoi({
    opens: input.engagement?.opened,
    clicks: input.engagement?.clicked,
    sent: input.engagement?.sent,
    workspaceRoi: input.workspaceRoi,
    spendCents: input.spendCents,
    attributedRevenueCents: input.attributedRevenueCents,
    attributedPipelineCents: input.attributedPipelineCents,
  });
  const launched = input.launched === true;
  const stage =
    input.stage ??
    defaultStage({ checklist, copyReady, launched, roi });

  return {
    stage,
    intake,
    checklist,
    sendReadiness: operational,
    copyReady,
    humanConfirmed,
    persistence: input.persistence,
    maySend,
    roi,
  };
}
