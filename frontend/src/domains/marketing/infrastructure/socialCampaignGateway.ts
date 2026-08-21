/**
 * The campaign port over the real social client. One method wide, so a use case
 * that only edits a campaign cannot reach `socialApi.publish`.
 */

import { socialApi } from '@/lib/socialApi';
import type { SocialCampaignPort } from '../application/SyncSocialCampaign';

export const socialCampaignGateway: SocialCampaignPort = {
  update: (campaignId, changes) => socialApi.updateCampaign(campaignId, changes),
};
