/**
 * SYNC SOCIAL CAMPAIGN — a campaign card edited on the board, written back.
 *
 * ── WHY IT IS NOT A CARD ACT ─────────────────────────────────────────────────
 * It looks like one and is not. A `CardAct` is invoked BY NAME on a card ("issue
 * this invoice"); this is the card's own inline editor propagating a patch the
 * person just typed. It takes fields rather than an action, and it runs on every
 * edit rather than on a click. Forcing it into the act registry would mean
 * inventing an action name nothing calls, so it is a plain use case instead.
 *
 * ── WHY IT IS IN `marketing/` ────────────────────────────────────────────────
 * PRD 22 §3.4 lists `syncSocialCampaign` among the use cases `CanvasInner` was
 * implementing for a context the canvas map names no owner for. It is marketing:
 * which fields of a campaign are editable after it exists, and what the board
 * shows once the server has accepted them.
 *
 * ── THE RULE WORTH HAVING SOMEWHERE TESTABLE ─────────────────────────────────
 * Only fields the person actually SET are sent. A `scheduledAt` the editor did
 * not touch is `undefined` and must not reach the server, because the server
 * reads `null` as "unschedule this" — so a patch that spread the whole card would
 * quietly cancel the send time every time somebody fixed a typo in the body.
 * `scheduledAt` is therefore the one field whose ABSENCE and whose `null` mean
 * different things, and that distinction was a `!== undefined` check buried in a
 * component.
 */

import type { SocialCampaign, SocialNetwork } from '@/lib/socialApi';
import type { CanvasObjectData } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';

/** How this use case reaches the campaign. One method, because one is what it needs. */
export interface SocialCampaignPort {
  update(campaignId: number, changes: SocialCampaignChanges): Promise<{ campaign: SocialCampaign }>;
}

export interface SocialCampaignChanges {
  body?: string;
  linkUrl?: string;
  mediaUrls?: string[];
  variants?: Partial<Record<SocialNetwork, string>>;
  /** `null` unschedules. Absent leaves the existing schedule alone — see above. */
  scheduledAt?: string | null;
}

export type SyncCampaignResult =
  | { ok: true; campaign: SocialCampaign }
  | { ok: false; notice: string };

/**
 * The subset of an edited card the campaign endpoint accepts.
 *
 * Exported separately from {@link syncSocialCampaign} because it is the whole
 * judgement: everything else in this file is a network call and an error message.
 */
export function socialCampaignChanges(patch: Partial<CanvasObjectData>): SocialCampaignChanges {
  return {
    ...(typeof patch.body === 'string' ? { body: patch.body } : {}),
    ...(typeof patch.linkUrl === 'string' ? { linkUrl: patch.linkUrl } : {}),
    ...(Array.isArray(patch.mediaUrls) ? { mediaUrls: patch.mediaUrls.map(String) } : {}),
    ...(patch.variants && typeof patch.variants === 'object'
      ? { variants: patch.variants as Partial<Record<SocialNetwork, string>> }
      : {}),
    ...(patch.scheduledAt !== undefined
      ? { scheduledAt: patch.scheduledAt ? String(patch.scheduledAt) : null }
      : {}),
  };
}

export async function syncSocialCampaign(
  campaignId: number,
  patch: Partial<CanvasObjectData>,
  campaigns: SocialCampaignPort,
  t: CanvasTextTranslator,
): Promise<SyncCampaignResult> {
  try {
    const { campaign } = await campaigns.update(campaignId, socialCampaignChanges(patch));
    return { ok: true, campaign };
  } catch (error) {
    return { ok: false, notice: error instanceof Error ? error.message : t('campaignUpdateFailed') };
  }
}
