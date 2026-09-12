/**
 * Tenant marketing — audiences, verified senders, suppression, and a real send
 * engine.
 *
 * What was here before: `sales_campaigns` (migration 0401), which is the
 * Builderforce referral team's own CRM — scoped to a USER, with `sent`/`replies`
 * as integers a human types in — and `MarketingService`, which is our own
 * marketing-site visitor telemetry. Neither let a TENANT contact the people who
 * signed up on the site they just built. This is that engine.
 *
 * FOUR THINGS IT REFUSES TO DO, BY CONSTRUCTION
 *  1. Send from a domain the tenant has not proven they own. A campaign without
 *     a `verified` sender identity cannot start (`startCampaign` rejects it),
 *     and ownership is a DNS TXT proof, not a checkbox.
 *  2. Email someone who opted out. Suppression is tenant-wide and evaluated at
 *     send time, so re-importing a list cannot resurrect an unsubscribed person.
 *  3. Email the same person twice. `marketing_campaign_sends` is unique on
 *     (campaign, email), so materializing is idempotent and a resumed or
 *     retried run skips what already went out.
 *  4. Send without a way out. Every message gets a working one-click
 *     unsubscribe link — appended by the renderer, not by the author, so it
 *     cannot be forgotten or removed.
 *
 * Sends run in BATCHES driven by the caller (a route for "send now", the cron
 * sweep for scheduled and resumed runs), because a Worker invocation cannot hold
 * a long loop and a partial send must be resumable.
 */
//
// ── WHERE IT LIVES ──────────────────────────────────────────────────────────────
// One module per concern under `./campaign/`, bottom-up:
//   audiences — audiences, members, the suppression list
//   senders   — DNS-verified sender identities
//   render    — the pure renderers and tracking URLs
//   campaigns — campaign records (list / create / edit a draft)
//   start     — the pre-flight and recipient materialization
//   send      — one resumable batch, and the batch policy constants
//   tracking  — open / click / unsubscribe / SMS status webhooks
//   sweeps    — the cron sweeps (due starts, in-flight batches)
// This module is the stable import path; it re-exports each public name.

export {
  addAudienceMembers,
  createAudience,
  listAudiences,
  refreshAudienceCount,
  suppressEmails,
  suppressedSubset,
  type AudienceMemberInput,
  type AudienceView,
} from './campaign/audiences';
export { createSender, listSenders, verifySender, type SenderResult, type SenderView } from './campaign/senders';
export {
  renderCampaignEmail,
  renderCampaignSms,
  resolveTrackingOrigin,
  smsStatusUrl,
  trackingUrls,
  SMS_BODY_MAX_CHARS,
  SMS_OPT_OUT_NOTICE,
  type CampaignRecipient,
  type RenderContext,
} from './campaign/render';
export {
  createCampaign,
  listCampaigns,
  updateCampaign,
  type CampaignResult,
  type CampaignView,
} from './campaign/campaigns';
export { startCampaign, type StartResult } from './campaign/start';
export { runCampaignBatch, CAMPAIGN_SEND_MAX_ATTEMPTS, SEND_BATCH_SIZE, type BatchResult } from './campaign/send';
export {
  recordClick,
  recordOpen,
  recordSmsDeliveryStatus,
  recordUnsubscribe,
  verifyCampaignSmsCallback,
  SMS_TERMINAL_FAILURES,
  TRACKING_PIXEL,
  type SmsCallbackVerification,
} from './campaign/tracking';
export {
  campaignsInFlight,
  runCampaignSendSweep,
  startDueCampaigns,
  type DueSweepResult,
} from './campaign/sweeps';
