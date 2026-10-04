

/** Social-campaign fields the SERVER owns — see `syncSocialCampaign`. Editing one on
 *  the tile has to write through, or the board shows one message and publishes another. */
export const SERVER_OWNED_CAMPAIGN_FIELDS = ['body', 'linkUrl', 'mediaUrls', 'variants', 'scheduledAt'] as const;
