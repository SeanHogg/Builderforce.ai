import { describe, expect, it } from 'vitest';
import {
  resolveVariant,
  SOCIAL_PUBLISH_BATCH_SIZE,
  SOCIAL_PUBLISH_MAX_ATTEMPTS,
} from './socialCampaignService';

/**
 * Per-network copy is the whole reason one announcement can go to five networks
 * without being written five times — and the fallback is what stops a campaign that
 * does not care from having to fill in five boxes.
 */
describe('resolveVariant', () => {
  const campaign = { body: 'Shared announcement', variants: { x: 'Short one', linkedin: '   ' } };

  it('prefers the network variant when it carries copy', () => {
    expect(resolveVariant(campaign, 'x')).toBe('Short one');
  });

  it('falls back to the shared body for a network with no variant', () => {
    expect(resolveVariant(campaign, 'tiktok')).toBe('Shared announcement');
  });

  it('treats a whitespace-only variant as absent — an empty post is never intended', () => {
    expect(resolveVariant(campaign, 'linkedin')).toBe('Shared announcement');
  });
});

describe('publish bounds', () => {
  it('bounds retries, so a misclassified retryable error cannot requeue forever', () => {
    expect(SOCIAL_PUBLISH_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(SOCIAL_PUBLISH_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });

  it('bounds one invocation, because a Worker request cannot hold an unbounded loop', () => {
    expect(SOCIAL_PUBLISH_BATCH_SIZE).toBeGreaterThan(0);
    expect(SOCIAL_PUBLISH_BATCH_SIZE).toBeLessThanOrEqual(25);
  });
});
