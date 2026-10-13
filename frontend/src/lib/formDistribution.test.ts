import { beforeEach, describe, expect, it, vi } from 'vitest';
import { growthApi } from './growthApi';
import { mailboxApi } from './mailboxApi';
import { socialApi } from './socialApi';
import {
  formCampaignBodyHtml, formCampaignSubject, formSocialBody, postForm, sendForm,
} from './formDistribution';

vi.mock('./growthApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./growthApi')>();
  return {
    ...actual,
    growthApi: {
      listAudiences: vi.fn(),
      createAudience: vi.fn(),
      addMembers: vi.fn(),
      listSenders: vi.fn(),
      createCampaign: vi.fn(),
      send: vi.fn(),
    },
  };
});

vi.mock('./mailboxApi', () => ({
  mailboxApi: { providers: vi.fn(async () => ({ providers: [], connections: [] })) },
}));

vi.mock('./socialApi', () => ({
  socialApi: {
    createCampaign: vi.fn(),
    publishCampaign: vi.fn(),
  },
}));

const audience = {
  id: 1, name: 'List', description: '', memberCount: 2, projectId: null, updatedAt: '',
};
const sender = {
  id: 9, fromEmail: 'a@x.com', fromName: 'A', replyTo: null, status: 'verified' as const,
  verifyToken: '', verifiedAt: '', lastError: null, recordName: '',
};
const campaign = {
  id: 7, name: 'Ask', subject: 'Would you answer Ask?', bodyHtml: '<p>', status: 'draft' as const,
  audienceId: 1, senderIdentityId: 9, transport: 'platform' as const, mailboxConnectionId: null,
  connectorConnectionId: null, templateId: null, fromName: '', projectId: null,
  recipients: 0, sent: 0, failed: 0, suppressed: 0, opened: 0, clicked: 0,
  startedAt: null, completedAt: null, updatedAt: '',
};

describe('form campaign copy', () => {
  it('puts the public URL in the body for anyone-with-the-link', () => {
    expect(formCampaignSubject('Ask')).toBe('Would you answer Ask?');
    expect(formCampaignBodyHtml({ title: 'Ask', shareUrl: 'https://x/f/hello', named: false }))
      .toContain('https://x/f/hello');
    expect(formCampaignBodyHtml({ title: 'Ask', shareUrl: 'https://x/f/hello', named: false }))
      .not.toContain('{{formUrl}}');
  });

  it('keeps the per-recipient token as a merge field for named recipients', () => {
    const html = formCampaignBodyHtml({ title: 'Ask', shareUrl: 'https://x/f/hello', named: true });
    expect(html).toContain('{{formUrl}}');
    expect(html).not.toContain('https://x/f/hello');
  });

  it('posts the share URL as the social link copy', () => {
    expect(formSocialBody('Ask', 'https://x/f/hello')).toBe('Would you answer Ask? https://x/f/hello');
  });
});

describe('sendForm', () => {
  beforeEach(() => {
    vi.mocked(growthApi.listAudiences).mockReset();
    vi.mocked(growthApi.createAudience).mockReset();
    vi.mocked(growthApi.addMembers).mockReset();
    vi.mocked(growthApi.listSenders).mockReset();
    vi.mocked(growthApi.createCampaign).mockReset();
    vi.mocked(growthApi.send).mockReset();
    vi.mocked(mailboxApi.providers).mockResolvedValue({ providers: [], connections: [] });
    vi.mocked(growthApi.listSenders).mockResolvedValue({ senders: [sender] });
  });

  it('refuses an unpublished form and does not touch the campaign rail', async () => {
    const result = await sendForm({
      title: 'Ask', shareUrl: '', audience: 'anyoneWithLink', recipients: [],
    });
    expect(result).toEqual({ ok: false, reason: 'unpublished' });
    expect(growthApi.createCampaign).not.toHaveBeenCalled();
  });

  it('refuses anyone-with-the-link with no audience rather than inventing a list', async () => {
    vi.mocked(growthApi.listAudiences).mockResolvedValue({ audiences: [] });
    const result = await sendForm({
      title: 'Ask', shareUrl: 'https://x/f/hello', audience: 'anyoneWithLink', recipients: [],
    });
    expect(result).toEqual({ ok: false, reason: 'noAudience' });
    expect(growthApi.createCampaign).not.toHaveBeenCalled();
  });

  it('puts tokenised URLs on named recipients and sends', async () => {
    vi.mocked(growthApi.listAudiences).mockResolvedValue({ audiences: [] });
    vi.mocked(growthApi.createAudience).mockResolvedValue({ ...audience, id: 3, memberCount: 0 });
    vi.mocked(growthApi.addMembers).mockResolvedValue({ added: 1, updated: 0, rejected: 0 });
    vi.mocked(growthApi.createCampaign).mockResolvedValue({ ...campaign, audienceId: 3 });
    vi.mocked(growthApi.send).mockResolvedValue({
      campaign: { ...campaign, audienceId: 3, status: 'sending' },
      queued: 1, suppressed: 0,
      batch: { sent: 1, failed: 0, remaining: 0, status: 'sent' },
    });
    const result = await sendForm({
      title: 'Ask',
      shareUrl: 'https://x/f/hello',
      audience: 'namedRecipients',
      recipients: [{ email: 'sam@x.com' }],
      invitations: [{ email: 'sam@x.com', token: 'tok-1' }],
    });
    expect(result).toEqual({ ok: true, campaignId: 7, queued: 1 });
    expect(growthApi.addMembers).toHaveBeenCalledWith(3, [expect.objectContaining({
      email: 'sam@x.com',
      attributes: { formUrl: 'https://x/f/hello?t=tok-1', formToken: 'tok-1' },
    })]);
    const body = vi.mocked(growthApi.createCampaign).mock.calls[0]![0];
    expect(body.bodyHtml).toContain('{{formUrl}}');
    expect(growthApi.send).toHaveBeenCalledWith(7);
  });

  it('uses the selected marketing audience for anyone-with-the-link', async () => {
    vi.mocked(growthApi.listAudiences).mockResolvedValue({ audiences: [audience] });
    vi.mocked(growthApi.createCampaign).mockResolvedValue(campaign);
    vi.mocked(growthApi.send).mockResolvedValue({
      campaign, queued: 2, suppressed: 0,
      batch: { sent: 2, failed: 0, remaining: 0, status: 'sent' },
    });
    const result = await sendForm({
      title: 'Ask',
      shareUrl: 'https://x/f/hello',
      audience: 'anyoneWithLink',
      recipients: [],
      marketingAudienceId: 1,
    });
    expect(result).toEqual({ ok: true, campaignId: 7, queued: 2 });
    expect(growthApi.createAudience).not.toHaveBeenCalled();
    expect(growthApi.addMembers).not.toHaveBeenCalled();
  });

  it('surfaces campaign blockers before send', async () => {
    vi.mocked(growthApi.listAudiences).mockResolvedValue({ audiences: [audience] });
    vi.mocked(growthApi.listSenders).mockResolvedValue({ senders: [] });
    vi.mocked(growthApi.createCampaign).mockResolvedValue({ ...campaign, senderIdentityId: null });
    const result = await sendForm({
      title: 'Ask',
      shareUrl: 'https://x/f/hello',
      audience: 'anyoneWithLink',
      recipients: [],
      marketingAudienceId: 1,
    });
    expect(result).toMatchObject({ ok: false, reason: 'blocked', campaignId: 7 });
    expect(result.ok === false && result.blockers).toContain('sender');
    expect(growthApi.send).not.toHaveBeenCalled();
  });
});

describe('postForm', () => {
  beforeEach(() => {
    vi.mocked(socialApi.createCampaign).mockReset();
    vi.mocked(socialApi.publishCampaign).mockReset();
  });

  it('refuses an unpublished form', async () => {
    const result = await postForm({ title: 'Ask', shareUrl: '' });
    expect(result).toEqual({ ok: false, reason: 'unpublished' });
    expect(socialApi.createCampaign).not.toHaveBeenCalled();
  });

  it('surfaces social blockers before publish', async () => {
    vi.mocked(socialApi.createCampaign).mockResolvedValue({
      campaign: {
        id: 4, name: 'Ask', body: 'Would you answer Ask? https://x/f/hello',
        linkUrl: 'https://x/f/hello', mediaUrls: [], variants: {}, status: 'draft',
        scheduledAtISO: null, startedAtISO: null, completedAtISO: null,
        targets: 0, published: 0, failed: 0, projectId: null, sessionId: null,
        updatedAtISO: '', posts: [],
        blockers: [{ code: 'noAccounts' }],
      },
      accounts: [],
    });
    const result = await postForm({ title: 'Ask', shareUrl: 'https://x/f/hello' });
    expect(result).toMatchObject({ ok: false, reason: 'blocked', campaignId: 4 });
    expect(socialApi.publishCampaign).not.toHaveBeenCalled();
  });

  it('creates then publishes with the share URL as the link', async () => {
    vi.mocked(socialApi.createCampaign).mockResolvedValue({
      campaign: {
        id: 4, name: 'Ask', body: 'Would you answer Ask? https://x/f/hello',
        linkUrl: 'https://x/f/hello', mediaUrls: [], variants: {}, status: 'draft',
        scheduledAtISO: null, startedAtISO: null, completedAtISO: null,
        targets: 1, published: 0, failed: 0, projectId: null, sessionId: null,
        updatedAtISO: '', posts: [], blockers: [],
      },
      accounts: [],
    });
    vi.mocked(socialApi.publishCampaign).mockResolvedValue({
      campaignId: 4, published: 1, failed: 0, skipped: 0, uploading: 0, remaining: 0,
      status: 'published', results: [], campaign: null,
    });
    const result = await postForm({ title: 'Ask', shareUrl: 'https://x/f/hello' });
    expect(result).toEqual({ ok: true, campaignId: 4, published: 1 });
    expect(socialApi.createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      linkUrl: 'https://x/f/hello',
      body: 'Would you answer Ask? https://x/f/hello',
    }));
  });
});
