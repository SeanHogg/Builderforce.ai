import { describe, expect, it } from 'vitest';
import { CHANNEL_PLATFORMS, isChannelPlatform } from './channelPlatforms';

describe('CHANNEL_PLATFORMS', () => {
  it('is a unique, non-empty list and accepts only its own members', () => {
    expect(CHANNEL_PLATFORMS.length).toBeGreaterThan(0);
    expect(new Set(CHANNEL_PLATFORMS).size).toBe(CHANNEL_PLATFORMS.length);
    for (const platform of CHANNEL_PLATFORMS) expect(isChannelPlatform(platform)).toBe(true);
    expect(isChannelPlatform('matrix')).toBe(false);
    expect(isChannelPlatform('')).toBe(false);
    expect(isChannelPlatform(undefined)).toBe(false);
  });
});
