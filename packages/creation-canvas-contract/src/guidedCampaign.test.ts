/**
 * The founder journey from "I want to run a marketing campaign".
 *
 * The consequential mistakes here are (1) treating a campaigns table as the
 * answer to a run prompt, (2) treating Growth send-blockers as the journey
 * checklist, (3) letting anonymous / agent actors send, (4) presenting
 * opens/clicks or workspace rollup as campaign ROI.
 */
import { describe, expect, it } from 'vitest';
import type { BrandBinding } from './marketing';
import {
  campaignRoi,
  copyPassesBrand,
  guidedCampaignRun,
  isCampaignListIntent,
  isCampaignRunIntent,
  journeyChecklist,
} from './guidedCampaign';

const brand: BrandBinding = {
  name: 'Acme',
  palette: ['#111111'],
  typography: ['Inter'],
  voice: 'plain, direct',
  doNotSay: ['the fastest', 'guaranteed'],
};

const readyIntake = {
  business: 'Acme',
  vertical: 'saas',
  offer: '14-day trial',
  goal: 'demand',
  channels: ['email' as const],
};

function readyRun(overrides: Partial<Parameters<typeof guidedCampaignRun>[0]> = {}) {
  return guidedCampaignRun({
    brand,
    audienceName: 'Founders',
    audienceConsent: 'optIn',
    audienceId: 'aud_1',
    size: 120,
    suppressedCount: 4,
    accounts: { email: true },
    intake: readyIntake,
    copySubject: 'Try Acme',
    copyBody: 'Start a 14-day trial this week.',
    persistence: 'server',
    ...overrides,
  });
}

describe('isCampaignRunIntent', () => {
  it('recognises the founder prompt and the connect-and-run variant', () => {
    expect(isCampaignRunIntent('I want to run a marketing campaign')).toBe(true);
    expect(isCampaignRunIntent('connect my email and run a marketing campaign')).toBe(true);
    expect(isCampaignRunIntent('launch a campaign')).toBe(true);
    expect(isCampaignRunIntent('create a campaign')).toBe(true);
  });

  it('does not treat a campaigns table request as a run', () => {
    expect(isCampaignRunIntent('list my campaigns')).toBe(false);
    expect(isCampaignRunIntent('show existing campaigns')).toBe(false);
    expect(isCampaignRunIntent('open the campaign portfolio')).toBe(false);
    expect(isCampaignRunIntent('marketing campaign ideas')).toBe(false);
    expect(isCampaignRunIntent('')).toBe(false);
  });

  it('lets run win when a list verb and a run verb both appear', () => {
    expect(isCampaignRunIntent('show me how to run a campaign')).toBe(true);
    expect(isCampaignListIntent('show me how to run a campaign')).toBe(false);
    expect(isCampaignListIntent('list my campaigns')).toBe(true);
  });
});

describe('journeyChecklist', () => {
  it('is ready without an ICP and is not ready without voice + doNotSay', () => {
    const ready = journeyChecklist({
      brand,
      audienceName: 'Founders',
      audienceConsent: 'optIn',
      accounts: { email: true },
      intake: readyIntake,
      copyBody: 'Start a 14-day trial this week.',
    });
    expect(ready.ready).toBe(true);
    expect(ready.items.every((item) => item.ready)).toBe(true);

    const noIcp = journeyChecklist({
      brand,
      audienceName: 'Founders',
      audienceConsent: 'optIn',
      accounts: { email: true },
      intake: { ...readyIntake, icp: undefined },
      copyBody: 'Start a 14-day trial this week.',
    });
    expect(noIcp.ready).toBe(true);

    const noVoice = journeyChecklist({
      brand: { ...brand, voice: undefined },
      audienceName: 'Founders',
      audienceConsent: 'optIn',
      accounts: { email: true },
      intake: readyIntake,
      copyBody: 'Start a 14-day trial this week.',
    });
    expect(noVoice.items.find((item) => item.item === 'brand')?.ready).toBe(false);
    expect(noVoice.ready).toBe(false);
  });

  it('keeps audience journey-ready when suppression was never retrieved', () => {
    const items = journeyChecklist({
      brand,
      audienceName: 'Founders',
      audienceConsent: 'optIn',
      accounts: { email: true },
      intake: readyIntake,
      copyBody: 'Start a 14-day trial this week.',
    });
    expect(items.items.find((item) => item.item === 'audience')?.ready).toBe(true);
  });

  it('requires every chosen channel to have a sender, and allows drafting without one', () => {
    const missingSms = journeyChecklist({
      brand,
      audienceName: 'Founders',
      audienceConsent: 'optIn',
      accounts: { email: true },
      intake: { ...readyIntake, channels: ['email', 'sms'] },
      copyBody: 'Start a 14-day trial this week.',
    });
    expect(missingSms.items.find((item) => item.item === 'sender')?.ready).toBe(false);
    expect(missingSms.ready).toBe(false);
  });
});

describe('copyPassesBrand', () => {
  it('refuses an empty draft and a doNotSay hit, and allows drafting without a kit', () => {
    expect(copyPassesBrand('', brand)).toBe(false);
    expect(copyPassesBrand('We are the fastest in SaaS', brand)).toBe(false);
    expect(copyPassesBrand('Start a 14-day trial this week.', brand)).toBe(true);
    expect(copyPassesBrand('Start a 14-day trial this week.', null)).toBe(true);
  });
});

describe('campaignRoi', () => {
  it('stays unknown when only opens, clicks, sent, or workspace rollup are supplied', () => {
    expect(campaignRoi({ opens: 40, clicks: 12, sent: 200, workspaceRoi: { revenue: 9_000 } })).toEqual({
      status: 'unknown',
    });
  });

  it('attributes spend and/or pipeline revenue for THIS campaign', () => {
    expect(campaignRoi({ spendCents: 50_000 })).toEqual({ status: 'attributed', spendCents: 50_000 });
    expect(campaignRoi({ attributedPipelineCents: 120_000 })).toEqual({
      status: 'attributed',
      attributedRevenueCents: 120_000,
    });
    expect(campaignRoi({ spendCents: 50_000, attributedRevenueCents: 150_000 })).toEqual({
      status: 'attributed',
      spendCents: 50_000,
      attributedRevenueCents: 150_000,
      roas: 3,
    });
  });
});

describe('guidedCampaignRun', () => {
  it('defaults empty channels to email and starts at intake when the offer is missing', () => {
    const run = guidedCampaignRun({
      brand: null,
      accounts: {},
      intake: { channels: [] },
      persistence: 'local',
    });
    expect(run.intake.channels).toEqual(['email']);
    expect(run.stage).toBe('intake');
    expect(run.maySend).toBe(false);
  });

  it('moves to connect when the offer is captured but the sender is not', () => {
    const run = readyRun({ accounts: {}, copyBody: undefined, copySubject: undefined });
    expect(run.stage).toBe('connect');
    expect(run.maySend).toBe(false);
  });

  it('does not send on a successful connect, even for a signed-in user', () => {
    const run = readyRun({ humanConfirmed: false });
    expect(run.checklist.items.find((item) => item.item === 'sender')?.ready).toBe(true);
    expect(run.maySend).toBe(false);
    expect(run.stage).toBe('confirm');
  });

  it('keeps sendReadiness distinct: journey-ready audience still needs a suppression check', () => {
    const run = readyRun({ suppressedCount: undefined, suppressionRetrieved: false, humanConfirmed: true });
    expect(run.checklist.items.find((item) => item.item === 'audience')?.ready).toBe(true);
    expect(run.sendReadiness.blockers).toContain('noSuppressionCheck');
    expect(run.sendReadiness.ready).toBe(false);
    expect(run.maySend).toBe(false);
  });

  it('lets a signed-in human send only after explicit confirm, with checklist and operational gates', () => {
    const run = readyRun({ humanConfirmed: true });
    expect(run.checklist.ready).toBe(true);
    expect(run.sendReadiness.ready).toBe(true);
    expect(run.maySend).toBe(true);
    expect(run.stage).toBe('confirm');
  });

  it('never lets an anonymous canvas or a cloud agent send', () => {
    expect(readyRun({ persistence: 'local', humanConfirmed: true }).maySend).toBe(false);
    expect(readyRun({ agentDraftOnly: true, humanConfirmed: true }).maySend).toBe(false);
  });

  it('does not treat opens/clicks as ROI, and tracks after launch', () => {
    const before = readyRun({
      humanConfirmed: true,
      engagement: { sent: 200, opened: 80, clicked: 12 },
      workspaceRoi: { revenue: 9_000 },
    });
    expect(before.roi.status).toBe('unknown');
    expect(before.stage).toBe('confirm');

    const after = readyRun({
      humanConfirmed: true,
      launched: true,
      spendCents: 25_000,
      attributedRevenueCents: 80_000,
    });
    expect(after.stage).toBe('track');
    expect(after.roi).toEqual({
      status: 'attributed',
      spendCents: 25_000,
      attributedRevenueCents: 80_000,
      roas: 3.2,
    });
  });
});
