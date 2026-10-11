import { describe, expect, it } from 'vitest';
import { campaignVideoDescription, pickVideoUrl } from './socialCampaignUploads';
import { campaignStatusFor } from './socialCampaignTotals';
import { getSocialProvider, publishTransportOf } from './socialProviders';

describe('YouTube in the social registry', () => {
  it('publishes media through an upload job — declared as data, not named in the engine', () => {
    const youtube = getSocialProvider('youtube')!;
    expect(youtube.publishMode).toBe('media');
    expect(publishTransportOf(youtube)).toBe('upload');
    expect(publishTransportOf(getSocialProvider('x')!)).toBe('direct');
  });
});

describe('pickVideoUrl', () => {
  it('prefers a URL whose path names a video over a picture listed first', () => {
    expect(pickVideoUrl(['https://cdn.example.com/cover.png', 'https://cdn.example.com/launch.mp4?sig=1'])).toBe('https://cdn.example.com/launch.mp4?sig=1');
  });

  it('falls back to the first URL and lets the job check its type', () => {
    expect(pickVideoUrl(['https://api.example.com/media/abc'])).toBe('https://api.example.com/media/abc');
    expect(pickVideoUrl([])).toBeNull();
  });
});

describe('campaignVideoDescription', () => {
  it('carries the post copy, then the link', () => {
    expect(campaignVideoDescription(' We shipped. ', 'https://example.com')).toBe('We shipped.\n\nhttps://example.com');
    expect(campaignVideoDescription('We shipped.', '')).toBe('We shipped.');
  });
});

describe('campaignStatusFor', () => {
  it('keeps a campaign publishing while a video is still uploading', () => {
    expect(campaignStatusFor({ published: 3, uploading: 1 })).toBe('publishing');
  });

  it('settles published once any post reached its network, failed otherwise', () => {
    expect(campaignStatusFor({ published: 1, failed: 2 })).toBe('published');
    expect(campaignStatusFor({ pending: 1 })).toBe('published');
    expect(campaignStatusFor({ failed: 1, skipped: 1 })).toBe('failed');
  });
});
