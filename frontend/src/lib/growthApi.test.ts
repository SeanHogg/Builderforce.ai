import { describe, expect, it } from 'vitest';
import { campaignBlockers, type Audience, type Campaign, type SenderIdentity } from './growthApi';

/**
 * `campaignBlockers` is the ONE place the client decides whether a campaign can
 * send. The Send button's `disabled` state and the reason rendered beside it
 * both read it, so these cases are what stops the two from drifting into "the
 * button is greyed out and nothing says why".
 *
 * It deliberately mirrors the server's `startCampaign` preconditions — a client
 * that let a doomed send through would just produce a 400 the user cannot act on.
 */

const campaign: Campaign = {
  id: 1, name: 'Launch', subject: 'Hello', bodyHtml: '<p>Hi</p>', status: 'draft',
  audienceId: 11, senderIdentityId: 5, projectId: null,
  transport: 'platform', mailboxConnectionId: null, connectorConnectionId: null,
  templateId: null, fromName: '',
  recipients: 0, sent: 0, failed: 0, suppressed: 0, opened: 0, clicked: 0,
  startedAt: null, completedAt: null, updatedAt: '2026-08-06T00:00:00Z',
};

const liveMailbox = { id: 3, status: 'connected', allowSending: true };

const verifiedSender: SenderIdentity = {
  id: 5, fromEmail: 'hi@acme.com', fromName: 'Acme', replyTo: null,
  status: 'verified', verifyToken: 'tok', verifiedAt: '2026-08-06T00:00:00Z',
  lastError: null, recordName: '_builderforce-sender.acme.com',
};

const populatedAudience: Audience = {
  id: 11, name: 'Signups', description: '', memberCount: 12, projectId: null,
  updatedAt: '2026-08-06T00:00:00Z',
};

describe('campaignBlockers', () => {
  it('is empty when everything is ready', () => {
    expect(campaignBlockers(campaign, [verifiedSender], [populatedAudience])).toEqual([]);
  });

  it('blocks a campaign that is no longer a draft', () => {
    expect(campaignBlockers({ ...campaign, status: 'sent' }, [verifiedSender], [populatedAudience]))
      .toContain('status');
  });

  it('blocks an empty or whitespace-only subject', () => {
    expect(campaignBlockers({ ...campaign, subject: '' }, [verifiedSender], [populatedAudience]))
      .toContain('subject');
    expect(campaignBlockers({ ...campaign, subject: '   ' }, [verifiedSender], [populatedAudience]))
      .toContain('subject');
  });

  it('blocks a missing, unknown or UNVERIFIED sender', () => {
    expect(campaignBlockers({ ...campaign, senderIdentityId: null }, [verifiedSender], [populatedAudience]))
      .toContain('sender');
    expect(campaignBlockers({ ...campaign, senderIdentityId: 99 }, [verifiedSender], [populatedAudience]))
      .toContain('sender');
    expect(campaignBlockers(campaign, [{ ...verifiedSender, status: 'pending' }], [populatedAudience]))
      .toContain('sender');
  });

  it('blocks an audience that is unknown or has no members', () => {
    expect(campaignBlockers(campaign, [verifiedSender], []))
      .toContain('audience');
    expect(campaignBlockers(campaign, [verifiedSender], [{ ...populatedAudience, memberCount: 0 }]))
      .toContain('audience');
  });

  it('reports EVERY blocker at once, so one fix does not just reveal the next', () => {
    const blockers = campaignBlockers({ ...campaign, subject: '', senderIdentityId: null }, [], []);
    expect(blockers).toEqual(expect.arrayContaining(['subject', 'sender', 'audience']));
  });

  /**
   * The identity check is TRANSPORT-DEPENDENT. Getting this wrong is not
   * cosmetic: a mailbox campaign has no sender identity at all, so an
   * unconditional "is the sender verified?" test would grey out a campaign that
   * is perfectly ready and offer a reason that makes no sense for it.
   */
  describe('per transport', () => {
    const mailboxCampaign: Campaign = {
      ...campaign, transport: 'mailbox', senderIdentityId: null, mailboxConnectionId: 3,
    };

    it('does NOT ask a mailbox campaign for a verified sender identity', () => {
      expect(campaignBlockers(mailboxCampaign, [], [populatedAudience], [liveMailbox])).toEqual([]);
    });

    it('blocks a mailbox campaign whose mailbox is missing, revoked or send-disabled', () => {
      expect(campaignBlockers(mailboxCampaign, [], [populatedAudience], []))
        .toContain('mailbox');
      expect(campaignBlockers(mailboxCampaign, [], [populatedAudience], [{ ...liveMailbox, status: 'revoked' }]))
        .toContain('mailbox');
      expect(campaignBlockers(mailboxCampaign, [], [populatedAudience], [{ ...liveMailbox, allowSending: false }]))
        .toContain('mailbox');
    });

    it('STILL requires a verified sender for SendGrid — the connector replaces the pipe, not the identity', () => {
      const viaSendGrid: Campaign = {
        ...campaign, transport: 'sendgrid', connectorConnectionId: 'conn-1',
      };
      expect(campaignBlockers(viaSendGrid, [verifiedSender], [populatedAudience])).toEqual([]);
      expect(campaignBlockers(viaSendGrid, [{ ...verifiedSender, status: 'pending' }], [populatedAudience]))
        .toContain('sender');
    });

    it('blocks a SendGrid campaign with no connection chosen', () => {
      expect(campaignBlockers(
        { ...campaign, transport: 'sendgrid', connectorConnectionId: null },
        [verifiedSender], [populatedAudience],
      )).toContain('connection');
    });
  });
});
