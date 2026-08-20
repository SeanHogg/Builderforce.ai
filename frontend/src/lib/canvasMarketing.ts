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
  forbiddenClaimsIn, resolveBrandBinding, sendReadiness,
  type BrandBinding, type BrandBoardObject, type SendReadiness,
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
