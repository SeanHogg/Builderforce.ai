/**
 * The canvas side of the marketing bindings — brand, audience and the send gate.
 *
 * ── WHAT IS HERE AND WHAT IS IN THE CONTRACT ─────────────────────────────────────
 * `@builderforce/creation-canvas-contract/marketing` owns the RULES: how a brand
 * resolves, what the directive says, how a sendable count is computed and when a send
 * must refuse. They live there because the API's creative dispatch and the campaign
 * sender read the same rules, and a brand applied two ways is a brand applied wrongly
 * once.
 *
 * What is here is the ADAPTER: canvas nodes carry their kind and title inside `data`,
 * a saved row carries them as columns, and this is the twelve lines that turn one into
 * the other. Exactly the split `canvasTriggers.ts` already draws for the trigger engine,
 * for the same reason.
 */

import {
  forbiddenClaimsIn, guidedCampaignRun, GUIDED_CAMPAIGN_CHANNELS, resolveBrandBinding, sendReadiness,
  type BrandBinding, type BrandBoardObject, type ChannelAccounts, type GuidedCampaignChannel,
  type GuidedCampaignIntake, type GuidedCampaignRun, type SendReadiness,
} from '@builderforce/creation-canvas-contract';

/** A canvas node as this module needs to see it. Structural rather than an import of the
 *  canvas node type, so nothing here depends on the component tree. */
export interface MarketingBoardNode {
  /** Optional because the two readers arrive by different routes: the canvas host holds
   *  React Flow nodes with ids, and a node BODY reads its neighbours' `data` out of the
   *  store without them. Nothing in this module needs the id — it is carried only so a
   *  caller that has one does not have to strip it. */
  id?: string;
  data: { kind: string; title?: string } & Record<string, unknown>;
}

/** Canvas nodes in the shape the contract's resolvers read. */
export function marketingBoard(nodes: readonly MarketingBoardNode[]): BrandBoardObject[] {
  return nodes.map((node) => ({ kind: node.data.kind, title: node.data.title ?? null, data: node.data }));
}

/**
 * The brand one node composes against, resolved from the board it is on.
 *
 * Returns `undefined` on a board with no `brandKit`, which is the majority of boards and
 * composes exactly as it did before this existed.
 */
export function brandForNode(
  node: Pick<MarketingBoardNode, 'data'>,
  nodes: readonly MarketingBoardNode[],
): BrandBinding | undefined {
  return resolveBrandBinding({ data: node.data }, marketingBoard(nodes));
}

/** The `audience` card an `emailCampaign` binds to, or null. Matched on `audienceId`
 *  first and on the audience's title second, because a campaign authored before the
 *  audience was refreshed has only the name. */
export function audienceForCampaign(
  campaign: Pick<MarketingBoardNode, 'data'>,
  nodes: readonly MarketingBoardNode[],
): MarketingBoardNode | null {
  const id = String(campaign.data.audienceId ?? '').trim();
  const name = String(campaign.data.audienceName ?? '').trim().toLowerCase();
  const audiences = nodes.filter((node) => node.data.kind === 'audience');
  return audiences.find((node) => id && String(node.data.audienceId ?? '').trim() === id)
    ?? audiences.find((node) => name && String(node.data.title ?? '').trim().toLowerCase() === name)
    ?? null;
}

/**
 * Whether this campaign may be fired from the board.
 *
 * ── WHY THE NUMBERS ARE READ AND NEVER COPIED ────────────────────────────────────
 * The size, the suppression count and the lawful basis are read off the bound `audience`
 * card at the moment the question is asked. They are deliberately not fields on the
 * campaign: a campaign field is a field an LLM patch can write, and a `suppressedCount`
 * an LLM can write is a `suppressedCount` an LLM can write as zero — which is the value
 * that unblocks the send. One fact, in one place, owned by the object that refreshed it.
 *
 * A campaign bound to no audience card gets `noSuppressionCheck` as well as `noAudience`,
 * which is correct and not redundant: it says both that nobody has been chosen and that
 * nobody has been excluded.
 */
export function campaignSendReadiness(
  campaign: Pick<MarketingBoardNode, 'data'>,
  nodes: readonly MarketingBoardNode[],
): SendReadiness {
  const audience = audienceForCampaign(campaign, nodes);
  const brand = brandForNode(campaign, nodes);
  const body = [campaign.data.subject, campaign.data.bodyHtml, campaign.data.content]
    .filter((part) => typeof part === 'string').join('\n');
  return sendReadiness({
    audienceId: campaign.data.audienceId,
    audienceName: campaign.data.audienceName,
    size: audience?.data.size,
    suppressedCount: audience?.data.suppressedCount,
    consentBasis: audience?.data.consentBasis,
    forbiddenClaims: forbiddenClaimsIn(body, brand),
  });
}

/**
 * The forbidden claims a generated artifact actually contains.
 *
 * The instruction half of the brand binding tells a model what not to say; this is the
 * half that CHECKS. An instruction a model ignored and nothing verified is exactly the
 * on-brand-by-review failure the binding exists to replace with on-brand-by-construction.
 */
export function brandViolationsIn(
  body: unknown,
  node: Pick<MarketingBoardNode, 'data'>,
  nodes: readonly MarketingBoardNode[],
): readonly string[] {
  return forbiddenClaimsIn(body, brandForNode(node, nodes));
}

/**
 * The GUIDED CAMPAIGN RUN as the canvas board sees it.
 *
 * sendReadiness remains the operational Growth gate (audience, consent,
 * suppression, forbidden claims). The journey checklist is the founder walk:
 * brand (voice + doNotSay), consenting audience, sender for the chosen
 * channel, offer, copy. Connect success never implies send. Anonymous boards
 * (`local`) and cloud agents stay draft-only.
 *
 * Campaign ROI is spend and/or pipeline/revenue attributed to THIS run.
 * Opens, clicks, and workspace `/api/roi/rollup` are ignored on purpose.
 */

const CHANNEL_ACCOUNT_KEYS: Record<GuidedCampaignChannel, readonly string[]> = {
  email: ['mailboxConnected', 'sendgridConnected', 'platformSenderReady', 'emailAccountReady'],
  sms: ['twilioConnected', 'smsAccountReady'],
  social: ['socialConnected', 'socialAccountReady'],
  ads: ['adsConnected', 'adsAccountReady'],
};

function asChannel(value: unknown): GuidedCampaignChannel | null {
  return (GUIDED_CAMPAIGN_CHANNELS as readonly string[]).includes(String(value))
    ? (value as GuidedCampaignChannel)
    : null;
}

function channelsOn(data: Record<string, unknown>): GuidedCampaignChannel[] {
  const raw = data.channels ?? data.channel;
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const seen = new Set<GuidedCampaignChannel>();
  for (const item of list) {
    const channel = asChannel(item);
    if (channel) seen.add(channel);
  }
  return [...seen];
}

function accountFlag(data: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => data[key] === true);
}

/** Sender / account flags the board already stores for Growth / Canvas connect. */
export function channelAccountsOnBoard(
  campaign: Pick<MarketingBoardNode, 'data'>,
  nodes: readonly MarketingBoardNode[],
): ChannelAccounts {
  const data = { ...campaign.data };
  for (const node of nodes) {
    Object.assign(data, node.data);
  }
  return {
    email: accountFlag(data, CHANNEL_ACCOUNT_KEYS.email),
    sms: accountFlag(data, CHANNEL_ACCOUNT_KEYS.sms),
    social: accountFlag(data, CHANNEL_ACCOUNT_KEYS.social),
    ads: accountFlag(data, CHANNEL_ACCOUNT_KEYS.ads),
  };
}

function campaignCopyBody(data: Record<string, unknown>): string {
  return [data.subject, data.bodyHtml, data.content, data.body, data.smsBody, data.primaryText]
    .filter((part) => typeof part === 'string' && part.trim())
    .join('\n');
}

function intakeFrom(data: Record<string, unknown>): GuidedCampaignIntake {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return {
    business: text(data.business ?? data.businessName),
    vertical: text(data.vertical),
    icp: text(data.icp ?? data.icpId),
    offer: text(data.offer ?? data.cta),
    goal: text(data.goal ?? data.campaignGoal),
    channels: channelsOn(data),
  };
}

/**
 * Compose the guided campaign run from the board. Persistence is the
 * anonymous vs signed-in split (`local` never sends). Cloud agents pass
 * `agentDraftOnly: true`.
 */
export function campaignJourney(
  campaign: Pick<MarketingBoardNode, 'data'>,
  nodes: readonly MarketingBoardNode[],
  opts: {
    persistence: 'local' | 'server';
    humanConfirmed?: boolean;
    agentDraftOnly?: boolean;
    launched?: boolean;
    workspaceRoi?: unknown;
  },
): GuidedCampaignRun {
  const audience = audienceForCampaign(campaign, nodes);
  const brand = brandForNode(campaign, nodes) ?? null;
  const data = campaign.data;
  const copyBody = campaignCopyBody(data);
  return guidedCampaignRun({
    brand,
    audienceName: String(data.audienceName ?? audience?.data.title ?? '').trim() || null,
    audienceConsent: (audience?.data.consentBasis as string | undefined) ?? null,
    audienceId: data.audienceId ?? audience?.data.audienceId,
    size: audience?.data.size,
    suppressedCount: audience?.data.suppressedCount,
    accounts: channelAccountsOnBoard(campaign, nodes),
    intake: intakeFrom(data),
    copySubject: typeof data.subject === 'string' ? data.subject : null,
    copyBody,
    persistence: opts.persistence,
    humanConfirmed: opts.humanConfirmed,
    agentDraftOnly: opts.agentDraftOnly,
    launched: opts.launched === true || data.status === 'sent' || data.status === 'published',
    spendCents: typeof data.spendCents === 'number' ? data.spendCents : undefined,
    attributedRevenueCents: typeof data.attributedRevenueCents === 'number' ? data.attributedRevenueCents : undefined,
    attributedPipelineCents: typeof data.attributedPipelineCents === 'number' ? data.attributedPipelineCents : undefined,
    engagement: {
      sent: typeof data.sent === 'number' ? data.sent : undefined,
      opened: typeof data.opened === 'number' ? data.opened : undefined,
      clicked: typeof data.clicked === 'number' ? data.clicked : undefined,
    },
    workspaceRoi: opts.workspaceRoi,
  });
}
