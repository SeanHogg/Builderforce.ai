import { describe, expect, it } from 'vitest';
import { CAMPAIGN_DELIVERY_MAX_ATTEMPTS, failedDeliveryStatus } from './campaignDelivery';
import { SOCIAL_PUBLISH_MAX_ATTEMPTS } from '../social/socialCampaignService';
import { CAMPAIGN_SEND_MAX_ATTEMPTS } from '../marketing/campaignEngine';

describe('failedDeliveryStatus — one retry rule for every campaign channel', () => {
  it('requeues a retryable failure that still has attempts left', () => {
    expect(failedDeliveryStatus(1, true)).toBe('queued');
    expect(failedDeliveryStatus(CAMPAIGN_DELIVERY_MAX_ATTEMPTS - 1, true)).toBe('queued');
  });

  it('writes off a retryable failure once the ceiling is reached, so a campaign completes', () => {
    expect(failedDeliveryStatus(CAMPAIGN_DELIVERY_MAX_ATTEMPTS, true)).toBe('failed');
  });

  it('never requeues a terminal failure', () => {
    expect(failedDeliveryStatus(1, false)).toBe('failed');
  });

  it('is the ceiling both the email and the social engine publish', () => {
    expect(CAMPAIGN_SEND_MAX_ATTEMPTS).toBe(CAMPAIGN_DELIVERY_MAX_ATTEMPTS);
    expect(SOCIAL_PUBLISH_MAX_ATTEMPTS).toBe(CAMPAIGN_DELIVERY_MAX_ATTEMPTS);
  });
});
