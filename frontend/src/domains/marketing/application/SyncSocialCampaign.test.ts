/**
 * The one rule in this file that can go wrong quietly.
 *
 * `scheduledAt` is the only field whose ABSENCE and whose `null` mean different
 * things to the server, so it is the only field a "just spread the card" patch
 * would break — and it would break it by unscheduling a send, which nobody sees
 * until the post does not go out.
 */

import { describe, expect, it, vi } from 'vitest';
import { socialCampaignChanges, syncSocialCampaign, type SocialCampaignPort } from './SyncSocialCampaign';

const t = (key: string) => key;

describe('socialCampaignChanges', () => {
  it('sends only the fields the editor actually set', () => {
    expect(socialCampaignChanges({ body: 'Launch day' })).toEqual({ body: 'Launch day' });
  });

  it('leaves an untouched schedule ALONE rather than clearing it', () => {
    expect(socialCampaignChanges({ body: 'typo fixed' })).not.toHaveProperty('scheduledAt');
  });

  it('sends null when the schedule was deliberately cleared', () => {
    expect(socialCampaignChanges({ scheduledAt: '' })).toEqual({ scheduledAt: null });
    expect(socialCampaignChanges({ scheduledAt: null })).toEqual({ scheduledAt: null });
  });

  it('ignores a field of the wrong shape rather than sending it', () => {
    expect(socialCampaignChanges({ body: 42, mediaUrls: 'one.png' })).toEqual({});
  });
});

describe('syncSocialCampaign', () => {
  it('returns the campaign the server accepted', async () => {
    const campaign = { id: 7, body: 'Launch day' };
    const campaigns = { update: vi.fn(async () => ({ campaign })) } as unknown as SocialCampaignPort;
    expect(await syncSocialCampaign(7, { body: 'Launch day' }, campaigns, t)).toEqual({ ok: true, campaign });
  });

  it('surfaces the server’s own message, falling back to the catalog', async () => {
    const named = { update: vi.fn(async () => { throw new Error('Campaign already published'); }) } as unknown as SocialCampaignPort;
    expect(await syncSocialCampaign(7, {}, named, t)).toEqual({ ok: false, notice: 'Campaign already published' });
    const anonymous = { update: vi.fn(async () => { throw 'nope'; }) } as unknown as SocialCampaignPort;
    expect(await syncSocialCampaign(7, {}, anonymous, t)).toEqual({ ok: false, notice: 'campaignUpdateFailed' });
  });
});
